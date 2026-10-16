import { describe, expect, it, vi } from "vitest";
import {
  createNinebotPassportLoginClient,
  PassportLoginBusinessError,
} from "./passport-login-client.ts";

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe("Passport login client", () => {
  it.each([
    [2, null, "unknown"],
    [2, "login rejected", "unknown"],
    [2, "captcha verification required", "human-verification"],
    [90202, "send code need verify", "human-verification"],
    [2, "请先完成人机验证", "human-verification"],
    [2, "invalid credentials", "invalid-credentials"],
    [2, "密码不正确", "invalid-credentials"],
    [2, "too many attempts", "rate-limited"],
  ] as const)(
    "classifies code %s only using explicit description %s",
    (code, description, rejection) => {
      const error = new PassportLoginBusinessError(code, description);
      expect(error.resultCode).toBe(code);
      expect(error.rejection).toBe(rejection);
      expect(error.message).toBe(`Ninebot passport request rejected: ${rejection}`);
    },
  );

  it("does not retain potentially private upstream descriptions in error objects", () => {
    const description = "captcha required: SYNTHETIC_PRIVATE_CHALLENGE_DATA";
    const error = new PassportLoginBusinessError(2, description);
    expect(error.rejection).toBe("human-verification");
    expect(error.stack).not.toContain("SYNTHETIC_PRIVATE_CHALLENGE_DATA");
    expect(JSON.stringify(error)).not.toContain("SYNTHETIC_PRIVATE_CHALLENGE_DATA");
  });

  it("sends the verified password request and parses the session", async () => {
    const send = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      body: json({
        resultCode: 0,
        resultDesc: "ok",
        data: {
          access_token: "access",
          refresh_token: "refresh",
          business_uid: "business",
          accessTokenValidity: 1_790_735_062,
        },
      }),
    });
    const client = createNinebotPassportLoginClient({
      transport: { send },
      signer: () => "signature",
    });

    await expect(
      client.loginWithPassword({
        areaCode: "+86",
        username: "user",
        password: "password",
        timestampMs: 1_700_000_000_000,
      }),
    ).resolves.toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAtMs: 1_790_735_062_000,
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/v6/user/login", method: "POST" }),
    );
  });

  it("lets the host decode gzip before parsing", async () => {
    const send = vi.fn().mockResolvedValue({ status: 200, headers: {}, body: new Uint8Array([1]) });
    const decode = vi
      .fn()
      .mockResolvedValue(
        json({ resultCode: 0, data: { access_token: "a", refresh_token: "r", uid: "u" } }),
      );
    const client = createNinebotPassportLoginClient({
      transport: { send },
      signer: () => "signature",
      responseBodyDecoder: decode,
    });

    await expect(
      client.loginWithPassword({ areaCode: "+86", username: "user", password: "password" }),
    ).resolves.toMatchObject({ accessToken: "a" });
    expect(decode).toHaveBeenCalled();
  });

  it("refreshes with the verified request shape and retains the business uid", async () => {
    const send = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      body: json({
        resultCode: 0,
        data: { access_token: "new-access", refresh_token: "new-refresh" },
      }),
    });
    const client = createNinebotPassportLoginClient({
      transport: { send },
      signer: () => "login-signature",
      refreshSigner: () => "refresh-signature",
    });

    await expect(
      client.refresh({ accessToken: "access", refreshToken: "refresh" }),
    ).resolves.toEqual({
      accessToken: "new-access",
      refreshToken: "new-refresh",
    });
    const request = send.mock.calls[0]?.[0];
    expect(request?.path).toBe("/v3/user/refresh");
    expect(new TextDecoder().decode(request?.body)).toBe(
      '{"accessToken":"access","device":"ANDROID","refreshToken":"refresh"}',
    );
  });

  it("loads whoami through the verified profile request boundary", async () => {
    const send = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      body: json({ resultCode: 0, data: { username: "user", hasPassword: true } }),
    });
    const client = createNinebotPassportLoginClient({
      transport: { send },
      signer: () => "login-signature",
      whoamiSigner: () => "whoami-signature",
      authorizationFactory: (current) => `Bearer ${current.accessToken}`,
    });

    await expect(
      client.whoami({ accessToken: "access", refreshToken: "refresh" }),
    ).resolves.toEqual({ username: "user", hasPassword: true });
    const request = send.mock.calls[0]?.[0];
    expect(request?.path).toBe("/v5/user");
    expect(request?.headers.authorization).toBe("Bearer access");
    expect(new TextDecoder().decode(request?.body)).toBe("{}");
  });

  it("uses the raw access token for the default whoami authorization header", async () => {
    const send = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      body: json({ resultCode: 0, data: { username: "user" } }),
    });
    const client = createNinebotPassportLoginClient({
      transport: { send },
      signer: () => "signature",
    });

    await client.whoami({
      accessToken: "raw-access",
      refreshToken: "refresh",
    });
    expect(send.mock.calls[0]?.[0]?.headers.authorization).toBe("raw-access");
  });

  it("accepts Passport's 90000 success code", async () => {
    const client = createNinebotPassportLoginClient({
      transport: {
        send: vi.fn().mockResolvedValue({
          status: 200,
          headers: {},
          body: json({
            resultCode: "90000",
            resultDesc: "success",
            data: { access_token: "a", refresh_token: "r", business_uid: "u" },
          }),
        }),
      },
      signer: () => "signature",
    });

    await expect(
      client.loginWithPassword({ areaCode: "+86", username: "user", password: "password" }),
    ).resolves.toMatchObject({ accessToken: "a" });
  });

  it("normalizes a string access-token validity returned by Passport", async () => {
    const client = createNinebotPassportLoginClient({
      transport: {
        send: vi.fn().mockResolvedValue({
          status: 200,
          headers: {},
          body: json({
            resultCode: "90000",
            data: {
              access_token: "a",
              refresh_token: "r",
              business_uid: "u",
              accessTokenValidity: "1790735062000",
            },
          }),
        }),
      },
      signer: () => "signature",
    });

    await expect(
      client.loginWithPassword({ areaCode: "+86", username: "user", password: "password" }),
    ).resolves.toMatchObject({ expiresAtMs: 1_790_735_062_000 });
  });

  it("surfaces non-success business codes without exposing response data", async () => {
    const client = createNinebotPassportLoginClient({
      transport: {
        send: vi.fn().mockResolvedValue({
          status: 200,
          headers: {},
          body: json({
            resultCode: 1001,
            resultDesc: "invalid credentials",
            data: { secret: "x" },
          }),
        }),
      },
      signer: () => "signature",
    });

    await expect(
      client.loginWithPassword({ areaCode: "+86", username: "user", password: "password" }),
    ).rejects.toBeInstanceOf(PassportLoginBusinessError);
    await expect(
      client.loginWithPassword({ areaCode: "+86", username: "user", password: "password" }),
    ).rejects.not.toThrow("secret");
  });
});
