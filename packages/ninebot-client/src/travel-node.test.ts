import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildTravelMonthEncryptedRequestCandidate,
  buildTravelMonthPlaintextBody,
  buildTravelCandidateHeaders,
  decodeTravelMonthResponseCandidate,
  parseTravelMonthResponseCandidate,
} from "./travel-node.ts";
import {
  encodeNinebotBase64,
  encryptAesCbcPkcs7,
  deriveNinebotKeyCandidate,
} from "./crypto-node.ts";

const fields = {
  sys_language: "zh-hans-cn",
  client_ver: "610063322",
  device_id: "device-id",
  regionx: "bj",
  language: "zh",
  ostype: "and",
  lang: "zh",
  platform_ver: "13 Xiaomi",
  platform: "android",
  login_country: "CN",
  access_token: "token",
  uid: "12345678",
  wnumber: "SN1234567890",
  rnVersion: "3.0",
  vehicle_type: "14363",
  month: "202608",
  page: "1",
  current_version: "610063322",
  serviceTime: 1_725_000_000,
  nonce: "0123456789abcdef0123456789abcdef",
} as const;

describe("Node travel month candidate", () => {
  it("builds the observed ordered body with an uppercase MD5 checkcode", () => {
    const text = new TextDecoder().decode(buildTravelMonthPlaintextBody(fields));
    expect(text).toContain('"wnumber":"SN1234567890","rnVersion":"3.0","vehicle_type":"14363"');
    expect(text).toMatch(/,"checkcode":"[0-9A-F]{32}"}$/);
  });

  it("rejects malformed month values before encryption", () => {
    expect(() => buildTravelMonthPlaintextBody({ ...fields, month: "202613" })).toThrow(
      "month is out of range",
    );
  });

  it("maps the travel headers including RN version metadata", () => {
    expect(
      buildTravelCandidateHeaders({
        fields,
        businessType: "2",
        requestId: "ABCDEF0123456789ABCDEF0123456789",
        serviceTime: 1_725_000_001,
      }),
    ).toMatchObject({
      accept: "application/json",
      "accept-encoding": "gzip",
      access_token: "token",
      "business-type": "2",
      "client-ver": "610063322",
      platform: "Android",
      "platform-ver": "13",
      "rn-module": "Track",
      "rn-ver": "3.0",
      "rn-version": "0",
      "request-id": "ABCDEF0123456789ABCDEF0123456789",
      "service-time": "1725000001",
    });
  });

  it("uses the observed envelope defaults and returns response context", () => {
    const result = buildTravelMonthEncryptedRequestCandidate({ fields, platform: 2 });
    expect(result.envelope).toMatchObject({ p: "101", t: "0" });
    expect(result.keyData.keyDataOne).toMatch(/^[0-9a-f]{11}$/);
    expect(result.keyData.keyDataTwo).toMatch(/^[0-9a-f]{11}$/);
    expect(result.keyData.keyDataThree).toMatch(/^[0-9a-f]{10}$/);
    expect(result.keyData.keyDataFour).toHaveLength(8);
  });

  it("parses the observed monthly aggregate and ride rows", () => {
    const parsed = parseTravelMonthResponseCandidate(
      new TextEncoder().encode(
        JSON.stringify({
          detail: [0, 12.4],
          duration: 3600,
          ec: 42,
          first_time: 1_725_000_000,
          list: [{ travel_id: "ride-1", speed: "53.00" }],
          month: "202608",
          times: 1,
          total_mileages: "12.4",
        }),
      ),
    );
    expect(parsed.month).toBe("202608");
    expect(parsed.detail).toEqual([0, 12.4]);
    expect(parsed.list).toEqual([{ travel_id: "ride-1", speed: "53.00" }]);
    expect(parsed.total_mileages).toBe("12.4");
  });

  it("unwraps the business response wrapper returned by travel-list2", () => {
    const parsed = parseTravelMonthResponseCandidate(
      new TextEncoder().encode(
        JSON.stringify({
          code: 1,
          desc: "ok",
          data: {
            detail: [],
            duration: 0,
            ec: 0,
            first_time: 0,
            list: [],
            month: "202608",
            times: 0,
            total_mileages: "0.0",
          },
          t: 1,
        }),
      ),
    );
    expect(parsed).toMatchObject({ code: 1, desc: "ok", month: "202608", list: [] });
  });

  it("decrypts and parses a candidate monthly response", () => {
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
    const business = new TextEncoder().encode(
      JSON.stringify({
        detail: [1, 0],
        duration: 120,
        ec: "4.2",
        first_time: 1_725_000_000,
        list: [],
        month: "202608",
        times: 0,
        total_mileages: "0.0",
      }),
    );
    const responseJson = new TextEncoder().encode(
      JSON.stringify({ data: encodeNinebotBase64(business), timeStamp: 1_725_000_000 }),
    );
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const request = buildTravelMonthEncryptedRequestCandidate({
      fields,
      platform: 2,
      rsaPublicKey: publicKey.export({ type: "spki", format: "pem" }),
    });
    const result = decodeTravelMonthResponseCandidate({
      envelope: {
        v: 101,
        s: encodeNinebotBase64(new Uint8Array(128)),
        r: encodeNinebotBase64(encryptAesCbcPkcs7({ plaintext: responseJson, key })),
      },
      keyData: { ...request.keyData, ...keyData },
    });
    expect(result).toMatchObject({ month: "202608", times: 0, list: [] });
  });
});
