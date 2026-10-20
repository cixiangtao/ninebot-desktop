import { describe, expect, it, vi } from "vitest";
import {
  createNinebotPassportLoginClient,
  PassportLoginBusinessError,
  PassportRefreshMaterialError,
} from "./passport-login-client.ts";
import { buildRefreshRequest } from "./passport-auth.ts";
import { createNinebotPassportWebSigner } from "./passport-signer.ts";

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe("Passport login client", () => {
  it("matches the saved original refresh body and signature without adding Authorization", async () => {
    // ev_b46d71aecaf9ec360d47dbe9349211f533481ac1201acb20873bbc8f43a4e5a8; not rerun.
    const request = await buildRefreshRequest({
      accessToken: "synthetic-access",
      refreshToken: "synthetic-refresh",
      timestampMs: 1792146206810,
      signer: createNinebotPassportWebSigner().refresh,
    });
    expect(new TextDecoder().decode(request.body)).toBe(
      '{"accessToken":"synthetic-access","device":"ANDROID","refreshToken":"synthetic-refresh"}',
    );
    expect(request.headers.sign).toBe(
      "6e752bc716b65eaca0d840d7e1aa7e035aa9449154fbd439554bec20816f2f44",
    );
    expect(request.headers.authorization).toBeUndefined();
  });

  it.each([
    { accessToken: "synthetic" },
    { accessToken: "synthetic", refreshToken: "" },
    { accessToken: "synthetic", refreshToken: " \t" },
    { accessToken: "", refreshToken: "synthetic" },
  ])("never sends refresh with missing/blank material", async (session) => {
    const send = vi.fn();
    const client = createNinebotPassportLoginClient({ transport: { send } });
    await expect(client.refresh(session)).rejects.toBeInstanceOf(PassportRefreshMaterialError);
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["resultDesc", "desc", "message"] as const)(
    "classifies explicit parameter errors from %s without retaining text",
    async (field) => {
      const client = createNinebotPassportLoginClient({
        transport: {
          send: async () => ({
            status: 200,
            headers: {},
            body: json({ resultCode: 90002, [field]: "args missing SYNTHETIC_PRIVATE_TEXT" }),
          }),
        },
      });
      try {
        await client.refresh({ accessToken: "synthetic", refreshToken: "synthetic" });
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toMatchObject({
          resultCode: 90002,
          rejection: "invalid-request",
          descriptionSource: field,
        });
        expect(JSON.stringify(error)).not.toContain("SYNTHETIC_PRIVATE_TEXT");
        expect(String(error)).not.toContain("SYNTHETIC_PRIVATE_TEXT");
      }
    },
  );

  it("does not infer a refresh rejection category from 90002 alone", () => {
    expect(new PassportLoginBusinessError(90002, null).rejection).toBe("unknown");
  });
  it.each(["password", "refresh", "profile"] as const)(
    "rejects a conflicting top-level code in %s",
    async (operation) => {
      const client = createNinebotPassportLoginClient({
        transport: {
          send: async () => ({
            status: 200,
            headers: {},
            body: json({
              code: 2,
              resultCode: 90000,
              data: {
                access_token: "synthetic-access",
                refresh_token: "synthetic-refresh",
                username: "synthetic-user",
              },
            }),
          }),
        },
      });
      const request =
        operation === "password"
          ? client.loginWithPassword({
              areaCode: "86",
              username: "synthetic",
              password: "synthetic",
            })
          : operation === "refresh"
            ? client.refresh({ accessToken: "synthetic", refreshToken: "synthetic" })
            : client.whoami({ accessToken: "synthetic" });
      await expect(request).rejects.toMatchObject({
        responseField: "code",
        resultCode: 2,
        rejection: "unknown",
      });
    },
  );

  it.each([true, [], {}])("rejects an invalid top-level code shape %j", async (code) => {
    const client = createNinebotPassportLoginClient({
      transport: {
        send: async () => ({
          status: 200,
          headers: {},
          body: json({
            code,
            resultCode: 90000,
            data: { access_token: "synthetic", refresh_token: "synthetic" },
          }),
        }),
      },
    });
    await expect(
      client.loginWithPassword({ areaCode: "86", username: "synthetic", password: "synthetic" }),
    ).rejects.toThrow("invalid code");
  });

  it("bounds arbitrary upstream code strings in error objects", () => {
    const error = new PassportLoginBusinessError(
      "synthetic-private-code",
      "synthetic-private-description",
      "code",
    );
    expect(error.resultCode).toBeNull();
    expect(error.responseField).toBe("code");
    expect(JSON.stringify(error)).not.toContain("synthetic-private");
  });
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
