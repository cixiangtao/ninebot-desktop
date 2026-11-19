import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildVehicleListEncryptedRequestCandidate,
  buildVehicleListCandidateHeaders,
  buildVehicleListPlaintextBody,
  createNinebotVehicleCandidateClient,
  createNinebotVehicleCandidateCodec,
  decodeVehicleListResponseCandidate,
  decodeVehicleListResponseCandidateWithCodec,
  ninebotVehicleCandidateProtocol,
  parseVehicleListResponseCandidate,
} from "./vehicle-node.ts";
import type { NinebotVehicleCodec } from "./vehicle-codec.ts";
import {
  decodeNinebotBase64,
  decryptAesCbcPkcs7,
  deriveNinebotKeyCandidate,
  encodeNinebotBase64,
  encryptAesCbcPkcs7,
} from "./crypto-node.ts";
import { parseNinebotEncryptedRequest } from "./crypto-envelope.ts";

const fields = {
  sys_language: "zh_CN",
  client_ver: "5.5.5.5",
  device_id: "device-id",
  regionx: "CN",
  language: "zh",
  ostype: "iOS",
  lang: "zh",
  platform_ver: "18.5.0",
  platform: "IOS",
  login_country: "CN",
  access_token: "token",
  uid: "12345678",
  vehicle_type: "12",
  serviceTime: 1_725_000_000_000,
  nonce: "0123456789abcdef0123456789abcdef",
} as const;

describe("Node vehicle request body candidate", () => {
  it("builds the observed ordered body with uppercase MD5 checkcode", () => {
    expect(new TextDecoder().decode(buildVehicleListPlaintextBody(fields))).toBe(
      '{"sys_language":"zh_CN","client_ver":"5.5.5.5","device_id":"device-id","regionx":"CN","language":"zh","ostype":"iOS","lang":"zh","platform_ver":"18.5.0","platform":"IOS","login_country":"CN","access_token":"token","uid":"12345678","vehicle_type":"12","serviceTime":1725000000000,"nonce":"0123456789abcdef0123456789abcdef","checkcode":"94D3F52B5F046D91D17FA1CBAE0DADDB"}',
    );
  });

  it("rejects a nonce outside the observed shape", () => {
    expect(() => buildVehicleListPlaintextBody({ ...fields, nonce: "invalid" })).toThrow(
      "nonce must be 32 hexadecimal characters",
    );
  });

  it("accepts the mixed-case hexadecimal nonce emitted by the oracle", () => {
    expect(
      buildVehicleListPlaintextBody({
        ...fields,
        nonce: "0123ABCdef4567890123ABCdef456789",
      }),
    ).toHaveLength(369);
  });

  it("returns request envelope and per-request response key context", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const result = buildVehicleListEncryptedRequestCandidate({
      fields,
      platform: 2,
      p: "100",
      t: "1",
      timeStamp: 1_725_000_000,
      rsaPublicKey: publicKey.export({ type: "spki", format: "pem" }),
    });

    expect(result.envelope).toMatchObject({ p: "100", t: "1" });
    expect(result.envelope.d).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(result.envelope.k).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(result.envelope.h).toMatch(/^[0-9a-f]{32}$/);
    expect(result.keyData.keyDataOne).toMatch(/^[0-9a-f]{11}$/);
    expect(result.keyData.keyDataTwo).toMatch(/^[0-9a-f]{11}$/);
    expect(result.keyData.keyDataThree).toMatch(/^[0-9a-f]{10}$/);
    expect(result.keyData.keyDataFour).toHaveLength(8);
  });

  it("defaults the observed protocol envelope values", () => {
    const result = buildVehicleListEncryptedRequestCandidate({
      fields,
      platform: 2,
      timeStamp: 1_725_000_000,
    });

    expect(result.envelope).toMatchObject(ninebotVehicleCandidateProtocol);
  });

  it("maps the observed vehicle headers and allows deterministic replay values", () => {
    expect(
      buildVehicleListCandidateHeaders({
        service: "motor",
        fields: {
          ...fields,
          platform: "android",
          platform_ver: "13 Xiaomi",
        },
        requestId: "ABCDEF0123456789ABCDEF0123456789",
        serviceTime: 1_725_000_001,
      }),
    ).toEqual({
      "business-type": "1",
      "cache-control": "no-cache",
      "client-ver": "5.5.5.5",
      "device-id": "device-id",
      debug: "0",
      access_token: "token",
      language: "zh",
      "login-country": "CN",
      platform: "Android",
      "platform-ver": "13",
      regionx: "CN",
      "request-id": "ABCDEF0123456789ABCDEF0123456789",
      "service-time": "1725000001",
      "sys-language": "zh_CN",
      uid: "12345678",
      "user-agent": "okhttp/4.9.1",
    });
  });

  it("uses the pinned ninecli public key when no override is supplied", () => {
    const result = buildVehicleListEncryptedRequestCandidate({
      fields,
      platform: 2,
      p: "100",
      t: "1",
      timeStamp: 1_725_000_000,
    });

    expect(decodeNinebotBase64(result.envelope.k, "request k")).toHaveLength(128);
  });

  it("runs the candidate client through a complete local request/response loop", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const business = new TextEncoder().encode(
      '{"code":0,"data":[{"wnumber":"demo"}],"desc":"ok","time_cost":4}',
    );
    const client = createNinebotVehicleCandidateClient({
      platform: 2,
      p: "100",
      t: "1",
      timeStamp: 1_725_000_000,
      rsaPublicKey: publicKey.export({ type: "spki", format: "pem" }),
      transport: {
        async send(request) {
          if (!request.body) throw new Error("missing request body");
          const requestEnvelope = parseNinebotEncryptedRequest(request.body);
          const kReq = new Uint8Array(
            privateDecrypt(
              { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
              decodeNinebotBase64(requestEnvelope.k, "request k"),
            ),
          );
          const wrapper = JSON.parse(
            new TextDecoder().decode(
              decryptAesCbcPkcs7({
                ciphertext: decodeNinebotBase64(requestEnvelope.d, "request d"),
                key: kReq,
              }),
            ),
          ) as {
            keyDataOne: string;
            keyDataTwo: string;
            keyDataThree: string;
            keyDataFour: string;
          };
          const responseKey = deriveNinebotKeyCandidate([
            new TextEncoder().encode(wrapper.keyDataOne),
            new TextEncoder().encode(wrapper.keyDataTwo),
            new TextEncoder().encode(wrapper.keyDataThree),
            new TextEncoder().encode(wrapper.keyDataFour),
          ]);
          const responsePlaintext = new TextEncoder().encode(
            JSON.stringify({ data: encodeNinebotBase64(business), timeStamp: 1_725_000_000 }),
          );
          return {
            status: 200,
            headers: {},
            body: new TextEncoder().encode(
              JSON.stringify({
                v: 1,
                s: encodeNinebotBase64(new Uint8Array(128)),
                r: encodeNinebotBase64(
                  encryptAesCbcPkcs7({ plaintext: responsePlaintext, key: responseKey }),
                ),
              }),
            ),
          };
        },
      },
    });

    await expect(client.list({ service: "motor", fields })).resolves.toEqual({
      code: 0,
      data: [{ wnumber: "demo" }],
      desc: "ok",
      time_cost: 4,
      extra: null,
    });
  });

  it("parses the decrypted business response envelope", () => {
    const payload = new TextEncoder().encode(
      '{"code":1,"data":[{"wnumber":"demo"}],"desc":"ok","time_cost":78}',
    );
    const parsed = parseVehicleListResponseCandidate(payload);
    expect(parsed).toEqual({
      code: 1,
      data: [{ wnumber: "demo" }],
      desc: "ok",
      time_cost: 78,
      extra: null,
    });
  });

  it("parses business metadata directly after codec decoding", async () => {
    const codec: NinebotVehicleCodec = {
      async encodeRequest() {
        return { d: "cipher", h: "hash", k: "key", p: "100", t: "1" };
      },
      async decodeResponse() {
        return new TextEncoder().encode(
          '{"code":0,"data":[{"wnumber":"demo"}],"desc":"ok","time_cost":12,"extra":{"trace":true}}',
        );
      },
    };

    await expect(
      decodeVehicleListResponseCandidateWithCodec({
        service: "motor",
        responseBody: '{"v":1,"s":"session","r":"cipher"}',
        codec,
      }),
    ).resolves.toEqual({
      code: 0,
      data: [{ wnumber: "demo" }],
      desc: "ok",
      time_cost: 12,
      extra: { trace: true },
    });
  });

  it("decrypts and parses a candidate response with its key context", () => {
    const keyData = {
      keyDataOne: "0123456789a",
      keyDataTwo: "fedcba98765",
      keyDataThree: "0011223344",
      keyDataFour: "Ab3;_+x/",
    };
    const key = deriveNinebotKeyCandidate([
      new TextEncoder().encode(keyData.keyDataOne),
      new TextEncoder().encode(keyData.keyDataTwo),
      new TextEncoder().encode(keyData.keyDataThree),
      new TextEncoder().encode(keyData.keyDataFour),
    ]);
    const business = new TextEncoder().encode('{"code":1,"data":[],"desc":"ok","time_cost":1}');
    const responseJson = new TextEncoder().encode(
      JSON.stringify({ data: encodeNinebotBase64(business), timeStamp: 1_725_000_000 }),
    );
    const ciphertext = encryptAesCbcPkcs7({ plaintext: responseJson, key });

    expect(
      decodeVehicleListResponseCandidate({
        envelope: {
          v: 1,
          s: encodeNinebotBase64(new Uint8Array(128)),
          r: encodeNinebotBase64(ciphertext),
        },
        keyData,
      }),
    ).toMatchObject({ code: 1, data: [], desc: "ok", time_cost: 1 });
  });

  it("implements the context-aware vehicle codec contract", async () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const codec = createNinebotVehicleCandidateCodec({
      platform: 2,
      p: "100",
      t: "1",
      timeStamp: 1_725_000_000,
      rsaPublicKey: publicKey.export({ type: "spki", format: "pem" }),
    });
    const encoded = await codec.encodeRequest({
      service: "motor",
      path: "/vehicle/binding/my-vehicle",
      headers: {},
      plaintextBody: new TextEncoder().encode("private"),
    });
    expect("envelope" in encoded).toBe(true);
    if (!("envelope" in encoded) || !encoded.responseContext) throw new Error("missing context");
    const keyData = encoded.responseContext as {
      keyDataOne: string;
      keyDataTwo: string;
      keyDataThree: string;
      keyDataFour: string;
    };
    const key = deriveNinebotKeyCandidate([
      new TextEncoder().encode(keyData.keyDataOne),
      new TextEncoder().encode(keyData.keyDataTwo),
      new TextEncoder().encode(keyData.keyDataThree),
      new TextEncoder().encode(keyData.keyDataFour),
    ]);
    const business = new TextEncoder().encode('{"code":1,"data":[],"desc":"ok","time_cost":1}');
    const responseJson = new TextEncoder().encode(
      JSON.stringify({ data: encodeNinebotBase64(business), timeStamp: 1_725_000_000 }),
    );
    const ciphertext = encryptAesCbcPkcs7({ plaintext: responseJson, key });
    await expect(
      codec.decodeResponse({
        service: "motor",
        path: "/vehicle/binding/my-vehicle",
        envelope: {
          v: 1,
          s: encodeNinebotBase64(new Uint8Array(128)),
          r: encodeNinebotBase64(ciphertext),
        },
        responseContext: encoded.responseContext,
      }),
    ).resolves.toEqual(business);
  });
});
