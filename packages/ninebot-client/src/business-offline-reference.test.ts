import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  createMemoryNinebotAuthSessionStore,
  NinebotAuthSessionManager,
  type NinebotPassportSession,
} from "./auth.ts";
import { observeAuthResult } from "./auth-result.ts";
import { referenceNinecli017BusinessResult } from "./auth-result-reference.ts";
import { createNinebotBusinessSessionInitializer } from "./business-session-node.ts";
import {
  computeNinebotCheckcode,
  decryptAesCbcPkcs7,
  deriveNinebotKeyCandidate,
  encryptAesCbcPkcs7,
} from "./crypto-node.ts";
import { createNinebotPassportAuthProvider } from "./passport-auth-provider.ts";
import type { NinebotTransport } from "./transport.ts";

// TS-only in-process replay. Never executes ninecli, opens sockets, loads files,
// reads an account/device store, or uses the production RSA key.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keys = generateKeyPairSync("rsa", { modulusLength: 1024 });
const passport: NinebotPassportSession = {
  accessToken: "synthetic-access",
  refreshToken: "synthetic-refresh",
  uuid: "0123456789abcdef0123456789abcdef",
};
const credentials = { areaCode: "86", user: "synthetic", password: "synthetic" };

const replay = (
  payload: unknown,
  options: {
    wrapper?: "object" | "quoted" | "raw";
    gzip?: boolean;
    status?: number;
    omitMetadata?: boolean;
  } = {},
) => {
  let requests = 0;
  const transport: NinebotTransport = {
    async send(request) {
      requests += 1;
      expect(request.service).toBe("business");
      expect(request.path).toBe("/user/user/login");
      const envelope = JSON.parse(decoder.decode(request.body)) as {
        k: string;
        d: string;
        h: string;
      };
      const padded = privateDecrypt(
        { key: keys.privateKey, padding: constants.RSA_NO_PADDING },
        Buffer.from(envelope.k, "base64"),
      );
      expect([...padded.subarray(0, 2)]).toEqual([0, 2]);
      const separator = padded.indexOf(0, 2);
      expect(separator).toBeGreaterThanOrEqual(10);
      const wrapperBytes = decryptAesCbcPkcs7({
        ciphertext: Buffer.from(envelope.d, "base64"),
        key: padded.subarray(separator + 1),
      });
      expect(envelope.h).toBe(computeNinebotCheckcode(wrapperBytes));
      const wrapper = JSON.parse(decoder.decode(wrapperBytes)) as {
        data: string;
        keyDataOne: string;
        keyDataTwo: string;
        keyDataThree: string;
        keyDataFour: string;
      };
      const fields = JSON.parse(Buffer.from(wrapper.data, "base64").toString("utf8")) as Record<
        string,
        unknown
      >;
      expect(fields).toMatchObject({
        access_token: passport.accessToken,
        token: passport.accessToken,
        uuid: passport.uuid,
      });
      expect(Object.keys(fields)).toHaveLength(18);
      const key = deriveNinebotKeyCandidate([
        encoder.encode(wrapper.keyDataOne),
        encoder.encode(wrapper.keyDataTwo),
        encoder.encode(wrapper.keyDataThree),
        encoder.encode(wrapper.keyDataFour),
      ]);
      const encoded = Buffer.from(JSON.stringify(payload)).toString("base64");
      const inner =
        options.wrapper === "quoted"
          ? JSON.stringify(encoded)
          : options.wrapper === "raw"
            ? encoded
            : JSON.stringify({ data: encoded });
      const r = Buffer.from(encryptAesCbcPkcs7({ plaintext: encoder.encode(inner), key })).toString(
        "base64",
      );
      const body = encoder.encode(
        JSON.stringify(options.omitMetadata ? { r } : { v: 101, s: "synthetic", r }),
      );
      return {
        status: options.status ?? 200,
        headers: options.gzip ? { "content-encoding": "gzip" } : {},
        body: options.gzip ? gzipSync(body) : body,
      };
    },
  };
  const initialize = createNinebotBusinessSessionInitializer({
    transport,
    deviceContext: async () => ({
      deviceId: "synthetic-device",
      region: "bj",
      osVersion: "13",
      osModel: "Synthetic",
    }),
    rsaPublicKey: keys.publicKey.export({ type: "spki", format: "pem" }),
    now: () => 1_725_000_000_000,
    nonceFactory: () => "0123456789abcdef0123456789abcdef",
  });
  return { initialize, requests: () => requests };
};

describe("Business in-process encrypted replay versus static ninecli predicate", () => {
  it.each<[string, unknown, boolean, boolean]>([
    ["number zero", { code: 0, data: { uid: "synthetic-uid" } }, true, false],
    ["number one", { code: 1, data: { uid: "synthetic-uid" } }, true, true],
    ["string zero", { code: "0", data: { uid: "synthetic-uid" } }, false, false],
    ["string one", { code: "1", data: { uid: "synthetic-uid" } }, false, true],
    ["missing code", { data: { uid: "synthetic-uid" } }, false, false],
    ...[null, true, [], {}, 2, -1, 1.5, 90000, "90000", "", "01"].map(
      (code): [string, unknown, boolean, boolean] => [
        `code ${JSON.stringify(code)}`,
        { code, data: { uid: "synthetic-uid" } },
        false,
        false,
      ],
    ),
    ["blank uid", { code: 1, data: { uid: " \t\n" } }, true, false],
    ...[null, true, 1, [], {}, ""].map((uid): [string, unknown, boolean, boolean] => [
      `uid ${JSON.stringify(uid)}`,
      { code: 1, data: { uid } },
      false,
      false,
    ]),
    ["missing uid", { code: 1, data: {} }, false, false],
    ...[null, [], "text"].map((data): [string, unknown, boolean, boolean] => [
      `data ${JSON.stringify(data)}`,
      { code: 1, data },
      false,
      false,
    ]),
    // Native Login checks code/data/uid only; TS additionally validates these fields.
    ["numeric desc", { code: 1, data: { uid: "synthetic-uid" }, desc: 7 }, true, false],
    ["string time_cost", { code: 1, data: { uid: "synthetic-uid" }, time_cost: "1" }, true, false],
  ])("%s", async (_name, payload, nativeAccepts, tsAccepts) => {
    expect(referenceNinecli017BusinessResult(observeAuthResult("business-login", payload))).toBe(
      nativeAccepts ? "accepted-material" : "reject",
    );
    const peer = replay(payload);
    if (tsAccepts) await expect(peer.initialize(passport)).resolves.toBe("synthetic-uid");
    else await expect(peer.initialize(passport)).rejects.toThrow();
    expect(peer.requests()).toBe(1);
  });

  it.each(["object", "quoted", "raw"] as const)(
    "TS accepts %s response wrapper (native only accepts object)",
    async (wrapper) => {
      await expect(
        replay({ code: 1, data: { uid: "synthetic-uid" } }, { wrapper }).initialize(passport),
      ).resolves.toBe("synthetic-uid");
    },
  );

  it("handles gzip without a socket or account store", async () => {
    await expect(
      replay({ code: 1, data: { uid: "synthetic-uid" } }, { gzip: true }).initialize(passport),
    ).resolves.toBe("synthetic-uid");
  });

  it("TS requires v/s metadata even though native DecryptResponse reads only r", async () => {
    await expect(
      replay({ code: 1, data: { uid: "synthetic-uid" } }, { omitMetadata: true }).initialize(
        passport,
      ),
    ).rejects.toThrow();
  });

  it.each([
    { ...passport, accessToken: "" },
    { accessToken: passport.accessToken, uuid: "synthetic-uuid" },
    { accessToken: passport.accessToken, refreshToken: "synthetic-refresh" },
    { ...passport, uuid: " \t" },
  ])("rejects incomplete credentials before transport", async (session) => {
    const peer = replay({ code: 1, data: { uid: "synthetic-uid" } });
    await expect(peer.initialize(session)).rejects.toMatchObject({ kind: "missing-credentials" });
    expect(peer.requests()).toBe(0);
  });

  it.each([false, true])(
    "preserves prior memory session=%s on Business failure and commits only complete success",
    async (hasPrior) => {
      const prior = { ...passport, accessToken: "prior-synthetic", businessUid: "prior-uid" };
      const store = createMemoryNinebotAuthSessionStore(hasPrior ? prior : null);
      const failed = replay({ code: 0, data: { uid: "synthetic-uid" } });
      let initializeBusinessSession = failed.initialize;
      const provider = createNinebotPassportAuthProvider(
        {
          loginWithPassword: async () => ({ ...passport }),
          refresh: async () => {
            throw new Error("unexpected refresh");
          },
          whoami: async () => {
            throw new Error("unexpected profile request");
          },
        },
        { initializeBusinessSession: (session) => initializeBusinessSession(session) },
      );
      const manager = new NinebotAuthSessionManager({ provider, store });
      await manager.restore();
      await expect(manager.loginWithPassword(credentials)).rejects.toMatchObject({
        kind: "business",
      });
      expect(manager.getSession()).toEqual(hasPrior ? prior : null);
      await expect(store.load()).resolves.toEqual(hasPrior ? prior : null);
      initializeBusinessSession = replay({ code: 1, data: { uid: "synthetic-uid" } }).initialize;
      await expect(manager.loginWithPassword(credentials)).resolves.toEqual({
        ...passport,
        businessUid: "synthetic-uid",
      });
      await expect(store.load()).resolves.toEqual({ ...passport, businessUid: "synthetic-uid" });
    },
  );
});
