import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildVehicleListEncryptedRequestCandidate,
  buildVehicleListPlaintextBody,
  decodeVehicleListResponseCandidate,
  parseVehicleListResponseCandidate,
} from "./vehicle-node.ts";
import {
  deriveNinebotKeyCandidate,
  encodeNinebotBase64,
  encryptAesCbcPkcs7,
} from "./crypto-node.ts";

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
      "nonce must be 32 lowercase hexadecimal characters",
    );
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
});
