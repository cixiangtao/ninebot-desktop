import { constants, createHash, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createMemoryNinebotAuthSessionStore,
  createNinebotSdk,
  type NinebotTransport,
  type NinebotCryptoAdapter,
} from "./index.ts";
import { createNinebotNodeCryptoAdapter } from "./platform-node.ts";
import { createNinebotWebCryptoAdapter } from "./platform-web.ts";
import {
  decryptAesCbcPkcs7,
  deriveNinebotKeyCandidate,
  encryptAesCbcPkcs7,
} from "./crypto-node.ts";

const encoder = new TextEncoder();
const credentials = { user: "synthetic", password: "test-only-password", areaCode: "86" };
const device = { deviceId: "test-device", region: "bj", osVersion: "13", osModel: "test" };
const ride = { service: "ebike" as const, serialNumber: "test-sn", vehicleType: 14363 };

/** An offline encrypted peer, using test-only keys and no real accounts or service calls. */
const createPeer = (factory: typeof createNinebotNodeCryptoAdapter) => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
  const crypto = factory({ rsaPublicKey: publicKey.export({ type: "spki", format: "pem" }) });
  const state = { now: 1_800_000_000_000, businessCode: 1, status: 200, challenge: false };
  const requests: Array<{ path: string; fields: Record<string, unknown> }> = [];
  const transport: NinebotTransport = {
    async send(request) {
      const envelope = JSON.parse(new TextDecoder().decode(request.body)) as Record<string, string>;
      if (request.service === "passport") {
        requests.push({ path: request.path, fields: envelope });
        if (state.challenge)
          return {
            status: 200,
            headers: {},
            body: encoder.encode(
              JSON.stringify({ resultCode: 90002, desc: "human verification required" }),
            ),
          };
        expect(request.headers.sign).toMatch(/^[0-9a-f]{64}$/);
        const refresh = request.path.includes("refresh");
        return {
          status: 200,
          headers: {},
          body: encoder.encode(
            JSON.stringify({
              resultCode: 90000,
              data: {
                access_token: refresh ? "refreshed-token" : "account-token",
                refresh_token: "refresh-token",
                uuid: "test-uuid",
                uid: "wrong-passport-uid",
                accessTokenValidity: String(state.now + 3_600_000),
              },
            }),
          ),
        };
      }
      const block = privateDecrypt(
        { key: privateKey, padding: constants.RSA_NO_PADDING },
        Buffer.from(envelope.k!, "base64"),
      );
      expect(block.subarray(0, 2)).toEqual(Buffer.from([0, 2]));
      const key = block.subarray(block.indexOf(0, 2) + 1);
      const wrapperBytes = decryptAesCbcPkcs7({
        key,
        ciphertext: Buffer.from(envelope.d!, "base64"),
      });
      expect(envelope.h).toBe(createHash("md5").update(wrapperBytes).digest("hex"));
      const wrapper = JSON.parse(new TextDecoder().decode(wrapperBytes)) as Record<string, string>;
      const fields = JSON.parse(Buffer.from(wrapper.data!, "base64").toString()) as Record<
        string,
        unknown
      >;
      const { checkcode, ...unsigned } = fields;
      expect(checkcode).toBe(
        createHash("md5").update(JSON.stringify(unsigned)).digest("hex").toUpperCase(),
      );
      expect(request.headers["request-id"]).toMatch(/^[0-9a-f]{32}$/);
      requests.push({ path: request.path, fields });
      let data: unknown;
      if (request.service === "business")
        data = { code: state.businessCode, data: { uid: "business-uid" } };
      else {
        expect(fields.uid).toBe("business-uid");
        expect(fields.access_token).toMatch(/^(account-token|refreshed-token)$/);
        if (request.path.includes("my-vehicle")) data = { code: 1, data: [{ sn: "test-sn" }] };
        else if (request.path.includes("travel-list2")) {
          const start = fields.page === "1" ? 0 : 20;
          data = {
            month: fields.month,
            times: 21,
            duration: 1200,
            total_mileages: 6,
            ec: 70,
            first_time: null,
            detail: [],
            list: Array.from({ length: start === 0 ? 20 : 1 }, (_, index) => ({
              id: String(start + index + 1),
            })),
          };
        } else if (request.path.includes("travel-info"))
          data = { code: 1, desc: null, data: { id: fields.travel_id, trail: "test-track" } };
        else if (request.path.includes("battery"))
          data = { code: 1, desc: null, time_cost: 1, data: { electricity: 80 } };
        else data = { code: 1, desc: null, time_cost: 1, data: [{ dump_energy: 80 }] };
      }
      const responseKey = deriveNinebotKeyCandidate([
        encoder.encode(wrapper.keyDataOne),
        encoder.encode(wrapper.keyDataTwo),
        encoder.encode(wrapper.keyDataThree),
        encoder.encode(wrapper.keyDataFour),
      ]);
      const plaintext = encoder.encode(
        JSON.stringify({ data: Buffer.from(JSON.stringify(data)).toString("base64") }),
      );
      return {
        status: state.status,
        headers: {},
        body: encoder.encode(
          JSON.stringify({
            v: 101,
            s: "synthetic",
            r: Buffer.from(encryptAesCbcPkcs7({ plaintext, key: responseKey })).toString("base64"),
          }),
        ),
      };
    },
  };
  const sessionStore = createMemoryNinebotAuthSessionStore();
  const save = vi.spyOn(sessionStore, "save");
  const options = {
    transport,
    crypto,
    sessionStore,
    deviceStore: { load: async () => ({ ...device }) },
    now: () => state.now,
  };
  return { state, requests, options, save, sdk: createNinebotSdk(options) };
};

describe.each([
  ["Node", createNinebotNodeCryptoAdapter],
  ["Web Crypto", createNinebotWebCryptoAdapter],
] as const)("portable SDK with %s adapter", (_name, factory) => {
  it("completes login, all read domains, full pagination, parallel decoding, refresh, restore and logout", async () => {
    const { sdk, options, state, requests, save } = createPeer(factory);
    expect(requests).toEqual([]);
    await expect(sdk.auth.restore()).resolves.toBeNull();
    await expect(sdk.auth.loginWithPassword(credentials)).resolves.toMatchObject({
      businessUid: "business-uid",
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(save.mock.calls)).not.toContain(credentials.password);
    await expect(sdk.vehicles.list(ride)).resolves.toMatchObject({ data: [{ sn: "test-sn" }] });
    const month = await sdk.travels.list({ ...ride, month: "202610" });
    expect(month.list).toHaveLength(21);
    expect(
      requests
        .filter((request) => request.path.includes("travel-list2"))
        .map((request) => request.fields.page),
    ).toEqual(["1", "2"]);
    const details = await Promise.all([
      sdk.travels.get({ ...ride, travelId: "a" }),
      sdk.travels.get({ ...ride, travelId: "b" }),
    ]);
    expect(details.map((detail) => detail.id)).toEqual(["a", "b"]);
    await expect(sdk.telemetry.status(ride)).resolves.toMatchObject({
      data: [{ dump_energy: 80 }],
    });
    await expect(sdk.telemetry.battery(ride)).resolves.toMatchObject({ data: { electricity: 80 } });
    state.now += 3_600_001;
    await sdk.travels.get({ ...ride, travelId: "after-refresh" });
    expect(requests.at(-1)?.fields.access_token).toBe("refreshed-token");
    const restored = createNinebotSdk(options);
    await expect(restored.auth.restore()).resolves.toMatchObject({
      accessToken: "refreshed-token",
    });
    await restored.auth.logout();
    await expect(createNinebotSdk(options).auth.restore()).resolves.toBeNull();
    const count = requests.length;
    await expect(restored.travels.get({ ...ride, travelId: "closed" })).rejects.toThrow(
      "not available",
    );
    expect(requests).toHaveLength(count);
  });

  it("never persists incomplete business login and surfaces server challenges", async () => {
    const { sdk, state, save } = createPeer(factory);
    state.businessCode = 0;
    await expect(sdk.auth.loginWithPassword(credentials)).rejects.toThrow("business");
    expect(save).not.toHaveBeenCalled();
    state.challenge = true;
    await expect(
      sdk.auth.requestSmsCode({ areaCode: "86", phone: "13800000000" }),
    ).rejects.toMatchObject({ rejection: "human-verification" });
    expect(save).not.toHaveBeenCalled();
  });

  it("discards late transport results after logout, even if the transport ignores abort", async () => {
    const peer = createPeer(factory);
    await peer.sdk.auth.loginWithPassword(credentials);
    const original = peer.options.transport.send;
    const entered = deferred();
    const released = deferred();
    peer.options.transport.send = async (request) => {
      const response = await original(request);
      entered.resolve();
      return released.promise.then(() => response);
    };
    const pending = peer.sdk.travels.get({ ...ride, travelId: "late" });
    await entered.promise;
    await peer.sdk.auth.logout();
    released.resolve();
    await expect(pending).rejects.toThrow(/cleared|changed/);
  });
});

it("does not transmit a request cancelled while asynchronous encryption is still running", async () => {
  const peer = createPeer(createNinebotNodeCryptoAdapter);
  await peer.sdk.auth.loginWithPassword(credentials);
  const original = peer.options.crypto.encode;
  const entered = deferred();
  const released = deferred();
  peer.options.crypto.encode = async (body) => {
    entered.resolve();
    await released.promise;
    return original(body);
  };
  const controller = new AbortController();
  const count = peer.requests.length;
  const pending = peer.sdk.travels.get({
    ...ride,
    travelId: "cancelled",
    signal: controller.signal,
  });
  await entered.promise;
  controller.abort(new Error("caller cancelled"));
  released.resolve();
  await expect(pending).rejects.toThrow("caller cancelled");
  expect(peer.requests).toHaveLength(count);
});

it("accepts a host crypto implementation without requiring Web Crypto globals", async () => {
  const peer = createPeer(createNinebotNodeCryptoAdapter);
  const supplied: NinebotCryptoAdapter = peer.options.crypto;
  expect(supplied.nonce()).toMatch(/^[0-9a-f]{32}$/);
  vi.stubGlobal("crypto", undefined);
  try {
    await expect(peer.sdk.auth.loginWithPassword(credentials)).resolves.toMatchObject({
      businessUid: "business-uid",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

function deferred() {
  let resolve: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve: () => resolve() };
}
