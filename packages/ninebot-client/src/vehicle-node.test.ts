import { describe, expect, it } from "vitest";
import { buildVehicleListPlaintextBody } from "./vehicle-node.ts";

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
});
