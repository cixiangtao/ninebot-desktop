import { describe, expect, it, vi } from "vitest";
import { type PassportRequest, buildPassportSmsRequest } from "./passport-auth.ts";
import { createNinebotPassportWebSigner } from "./passport-signer.ts";
import { createNinebotPassportLoginClient } from "./passport-login-client.ts";
import { createNinebotPassportAuthProvider } from "./passport-auth-provider.ts";
import { createMemoryNinebotAuthSessionStore, NinebotAuthSessionManager } from "./auth.ts";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const session = {
  accessToken: "synthetic-access",
  refreshToken: "synthetic-refresh",
  uuid: "synthetic-uuid",
};
const data = {
  access_token: session.accessToken,
  refresh_token: session.refreshToken,
  uuid: session.uuid,
};
const input = { areaCode: "86", phone: "15500000000" };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("Passport SMS implementation (no network)", () => {
  it("reproduces the saved original send-code request/signature fixture", async () => {
    // ev_c4ef2c86d2649ad41e0cbac4fc8dc0d91079f2126e268fa1f8c0bfae230cd648; not rerun.
    const request = await buildPassportSmsRequest({
      ...input,
      timestampMs: 1792380909679,
      signer: createNinebotPassportWebSigner().sms,
    });
    expect(request.path).toBe("/v4/code/phone");
    expect(new TextDecoder().decode(request.body)).toBe(
      '{"account":"15500000000","areaCode":"86","rawTemplate":"login"}',
    );
    expect(request.headers.sign).toBe(
      "057ccd1f8126781934711691f352e951553659e0e72bcec4acd2017bdcc16ea9",
    );
  });

  it("reproduces the saved original consume-code signature fixture", async () => {
    const request = await buildPassportSmsRequest({
      ...input,
      code: "123456",
      timestampMs: 1792380913839,
      signer: createNinebotPassportWebSigner().sms,
    });
    expect(request.headers.sign).toBe(
      "814bcd78fcd4189ca552a9902db92ea5e8540e4d550333fd32a3e0b79abdfbf8",
    );
    expect(new TextDecoder().decode(request.body)).toBe(
      '{"areaCode":"86","code":"123456","device":"ANDROID","phone":"15500000000","region":"bj"}',
    );
  });

  it("signs the user-completed verification result in the actual SMS send body", async () => {
    const request = await buildPassportSmsRequest({
      ...input,
      validate: "synthetic-check-result",
      timestampMs: 1792380909679,
      signer: createNinebotPassportWebSigner().sms,
    });
    expect(request.path).toBe("/v4/code/phone");
    expect(new TextDecoder().decode(request.body)).toBe(
      '{"account":"15500000000","areaCode":"86","rawTemplate":"login","validate":"synthetic-check-result"}',
    );
    // Independently calculated with Python hashlib from the literal sorted wire fields.
    expect(request.headers.sign).toBe(
      "12bb17b16e01d391e56aa55d08c3154e1490fb7ee1c2c8fc01f414c75ec39135",
    );
  });

  it.each(["", "  ", "x".repeat(4097), null, 123])(
    "rejects malformed verification results before signing or sending (%#)",
    async (validate) => {
      const send = vi.fn();
      const smsSigner = vi.fn();
      const client = createNinebotPassportLoginClient({ transport: { send }, smsSigner });
      await expect(
        client.requestSmsCode({ ...input, validate } as unknown as Parameters<
          typeof client.requestSmsCode
        >[0]),
      ).rejects.toThrow("Invalid Passport SMS input");
      expect(send).not.toHaveBeenCalled();
      expect(smsSigner).not.toHaveBeenCalled();
    },
  );

  it("does not accept a verification result in a consume-code request", async () => {
    const signer = vi.fn();
    await expect(
      buildPassportSmsRequest({
        ...input,
        code: "123456",
        validate: "synthetic-check-result",
        signer,
      }),
    ).rejects.toThrow("Invalid Passport SMS input");
    expect(signer).not.toHaveBeenCalled();
  });

  it("rejects an already cancelled SMS request without signing or sending", async () => {
    const controller = new AbortController();
    const reason = new Error("synthetic cancellation");
    controller.abort(reason);
    const send = vi.fn();
    const smsSigner = vi.fn();
    const client = createNinebotPassportLoginClient({ transport: { send }, smsSigner });
    await expect(client.requestSmsCode({ ...input, signal: controller.signal })).rejects.toBe(
      reason,
    );
    expect(smsSigner).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send a validated retry cancelled while asynchronous signing is pending", async () => {
    const controller = new AbortController();
    const signing = deferred<string>();
    const signingStarted = deferred<void>();
    const send = vi.fn();
    const client = createNinebotPassportLoginClient({
      transport: { send },
      smsSigner: async () => {
        signingStarted.resolve();
        return signing.promise;
      },
    });
    const pending = client.requestSmsCode({
      ...input,
      validate: "synthetic-check-result",
      signal: controller.signal,
    });
    await signingStarted.promise;
    const reason = new Error("synthetic form closed");
    controller.abort(reason);
    signing.resolve("synthetic-signature");
    await expect(pending).rejects.toBe(reason);
    expect(send).not.toHaveBeenCalled();
  });

  it("passes the same cancellation signal to transport and rejects a late success", async () => {
    const controller = new AbortController();
    const response = deferred<{
      status: number;
      headers: Record<string, string>;
      body: Uint8Array;
    }>();
    const sending = deferred<void>();
    const send = vi.fn(async (_request: PassportRequest) => {
      sending.resolve();
      return response.promise;
    });
    const responseBodyDecoder = vi.fn((result: { body: Uint8Array }) => result.body);
    const client = createNinebotPassportLoginClient({
      transport: { send },
      smsSigner: async () => "synthetic-signature",
      responseBodyDecoder,
    });
    const pending = client.requestSmsCode({ ...input, signal: controller.signal });
    await sending.promise;
    expect(send.mock.calls[0]?.[0].signal).toBe(controller.signal);
    expect(JSON.parse(new TextDecoder().decode(send.mock.calls[0]?.[0].body))).not.toHaveProperty(
      "signal",
    );
    const reason = new Error("synthetic cancellation after send");
    controller.abort(reason);
    response.resolve({ status: 200, headers: {}, body: encode({ resultCode: 90000 }) });
    await expect(pending).rejects.toBe(reason);
    expect(responseBodyDecoder).not.toHaveBeenCalled();
  });

  it("rejects cancellation while decoding an otherwise successful SMS response", async () => {
    const controller = new AbortController();
    const decoded = deferred<Uint8Array>();
    const decoding = deferred<void>();
    const client = createNinebotPassportLoginClient({
      transport: { send: async () => ({ status: 200, headers: {}, body: new Uint8Array() }) },
      smsSigner: async () => "synthetic-signature",
      responseBodyDecoder: async () => {
        decoding.resolve();
        return decoded.promise;
      },
    });
    const pending = client.requestSmsCode({ ...input, signal: controller.signal });
    await decoding.promise;
    const reason = new Error("synthetic cancellation during decode");
    controller.abort(reason);
    decoded.resolve(encode({ resultCode: 90000 }));
    await expect(pending).rejects.toBe(reason);
  });

  it("passes verification through the auth manager only for an explicit retry without storing it", async () => {
    const send = vi
      .fn(async (_request: PassportRequest) => ({
        status: 200,
        headers: {},
        body: encode({ resultCode: 90000, data: {} }),
      }))
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        body: encode({ resultCode: 90202 }),
      });
    const store = { load: vi.fn(async () => null), save: vi.fn(), clear: vi.fn() };
    const initializeBusinessSession = vi.fn();
    const auth = new NinebotAuthSessionManager({
      provider: createNinebotPassportAuthProvider(
        createNinebotPassportLoginClient({ transport: { send } }),
        { initializeBusinessSession },
      ),
      store,
    });
    await expect(auth.requestSmsCode(input)).rejects.toMatchObject({
      rejection: "human-verification",
    });
    expect(send).toHaveBeenCalledOnce();
    await auth.requestSmsCode({ ...input, validate: "synthetic-check-result" });
    expect(JSON.parse(new TextDecoder().decode(send.mock.calls[1]?.[0]?.body))).toEqual({
      account: input.phone,
      areaCode: input.areaCode,
      rawTemplate: "login",
      validate: "synthetic-check-result",
    });
    await auth.requestSmsCode(input);
    expect(JSON.parse(new TextDecoder().decode(send.mock.calls[2]?.[0]?.body))).not.toHaveProperty(
      "validate",
    );
    expect(store.save).not.toHaveBeenCalled();
    expect(initializeBusinessSession).not.toHaveBeenCalled();
  });

  it("constructs consume-code with the configured region and ANDROID device", async () => {
    const signer = vi.fn(async () => "synthetic-signature");
    const request = await buildPassportSmsRequest({
      ...input,
      code: "123456",
      region: "synthetic-region",
      timestampMs: 123,
      signer,
    });
    expect(request.path).toBe("/v6/user/phoneCodeLogin");
    expect(JSON.parse(new TextDecoder().decode(request.body))).toEqual({
      ...input,
      code: "123456",
      region: "synthetic-region",
      device: "ANDROID",
    });
    expect(signer).toHaveBeenCalledWith(
      expect.objectContaining({ path: request.path, timestamp: "123" }),
    );
  });

  it.each([90000, "90000"])("accepts only explicit send success %s", async (resultCode) => {
    const send = vi.fn(async () => ({
      status: 200,
      headers: {},
      body: encode({ resultCode, data: {} }),
    }));
    await expect(
      createNinebotPassportLoginClient({ transport: { send } }).requestSmsCode(input),
    ).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([
    {},
    { resultCode: null },
    { resultCode: 0 },
    { resultCode: 2 },
    { resultCode: true },
    { resultCode: 90000, code: 2 },
  ])("rejects unconfirmed send responses %j", async (payload) => {
    const client = createNinebotPassportLoginClient({
      transport: { send: async () => ({ status: 200, headers: {}, body: encode(payload) }) },
    });
    await expect(client.requestSmsCode(input)).rejects.toThrow();
  });

  it("surfaces the observed send-code challenge without retaining its payload", async () => {
    const client = createNinebotPassportLoginClient({
      transport: {
        send: async () => ({
          status: 200,
          headers: {},
          body: encode({
            resultCode: 90202,
            resultDesc: "synthetic-private-data",
            data: { secret: "synthetic-private-data" },
          }),
        }),
      },
    });
    await expect(client.requestSmsCode(input)).rejects.toMatchObject({
      rejection: "human-verification",
    });
    try {
      await client.requestSmsCode(input);
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain("synthetic-private-data");
    }
  });

  it("uses the injected decoder and region for successful consumption", async () => {
    const send = vi.fn(async (_request: PassportRequest) => ({
      status: 200,
      headers: {},
      body: new Uint8Array(),
    }));
    const client = createNinebotPassportLoginClient({
      transport: { send },
      smsRegion: async () => "configured-region",
      responseBodyDecoder: () => encode({ resultCode: 90000, data }),
    });
    await expect(client.loginWithSmsCode({ ...input, code: "123456" })).resolves.toEqual(session);
    expect(JSON.parse(new TextDecoder().decode(send.mock.calls[0]?.[0]?.body))).toMatchObject({
      region: "configured-region",
    });
  });

  it("never changes a missing consume code into an SMS send", async () => {
    const send = vi.fn();
    const client = createNinebotPassportLoginClient({ transport: { send } });
    await expect(
      client.loginWithSmsCode({ ...input, code: undefined } as unknown as Parameters<
        typeof client.loginWithSmsCode
      >[0]),
    ).rejects.toThrow("Invalid Passport SMS input");
    expect(send).not.toHaveBeenCalled();
  });

  it("saves SMS sessions only after Business initialization and preserves old sessions on failure", async () => {
    const previous = { ...session, businessUid: "prior-uid" };
    const store = createMemoryNinebotAuthSessionStore(previous);
    const initializeBusinessSession = vi
      .fn()
      .mockRejectedValueOnce(new Error("synthetic-business-failure"))
      .mockResolvedValueOnce("business-uid");
    const client = {
      loginWithPassword: async () => session,
      requestSmsCode: vi.fn(async () => undefined),
      loginWithSmsCode: vi.fn(async () => session),
      refresh: async () => session,
      whoami: async <T>() => null as T,
    };
    const auth = new NinebotAuthSessionManager({
      provider: createNinebotPassportAuthProvider(client, { initializeBusinessSession }),
      store,
    });
    await auth.restore();
    await auth.requestSmsCode(input);
    expect(initializeBusinessSession).not.toHaveBeenCalled();
    await expect(auth.loginWithSmsCode({ ...input, code: "123456" })).rejects.toThrow(
      "synthetic-business-failure",
    );
    await expect(store.load()).resolves.toEqual(previous);
    await expect(auth.loginWithSmsCode({ ...input, code: "123456" })).resolves.toEqual({
      ...session,
      businessUid: "business-uid",
    });
    expect(initializeBusinessSession).toHaveBeenCalledWith(session);
    await expect(store.load()).resolves.toEqual({ ...session, businessUid: "business-uid" });
  });
});
