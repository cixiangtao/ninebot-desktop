import { describe, expect, it, vi } from "vitest";
import {
  createNinebotPassportLoginClient,
  PassportLoginBusinessError,
} from "./passport-login-client.ts";

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe("Passport login client", () => {
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
      businessUid: "business",
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
    ).resolves.toMatchObject({ accessToken: "a", businessUid: "u" });
    expect(decode).toHaveBeenCalled();
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
