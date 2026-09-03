import { describe, expect, it } from "vitest";
import {
  buildBusinessLoginEncryptedRequest,
  buildBusinessLoginHeaders,
  buildBusinessLoginPlaintextBody,
  businessLoginPath,
} from "./business-login-node.ts";

const fields = {
  sys_language: "zh-hans-cn",
  client_ver: "610063322",
  device_id: "device-id",
  regionx: "bj",
  language: "zh",
  ostype: "and",
  lang: "zh",
  platform_ver: "13 Pixel",
  platform: "android",
  login_country: "CN",
  access_token: "access-token",
  uuid: "0123456789abcdef0123456789abcdef",
  token: "access-token",
  refresh_token: "refresh-token",
  region: "bj",
  serviceTime: 1_725_000_000_000,
  nonce: "0123456789abcdef0123456789abcdef",
} as const;

describe("business login candidate", () => {
  it("builds the observed ordered plaintext with an uppercase MD5 checkcode", () => {
    const body = new TextDecoder().decode(buildBusinessLoginPlaintextBody(fields));
    expect(body).toContain(
      '"sys_language":"zh-hans-cn","client_ver":"610063322","device_id":"device-id","regionx":"bj","language":"zh","ostype":"and","lang":"zh","platform_ver":"13 Pixel","platform":"android","login_country":"CN","access_token":"access-token","uuid":"0123456789abcdef0123456789abcdef","token":"access-token","refresh_token":"refresh-token","region":"bj","serviceTime":1725000000000,"nonce":"0123456789abcdef0123456789abcdef","checkcode":"',
    );
    expect(body).toMatch(/"checkcode":"[0-9A-F]{32}"}$/);
  });

  it("matches the business-login header contract", () => {
    expect(
      buildBusinessLoginHeaders({
        fields,
        requestId: "abcdefabcdefabcdefabcdefabcdefab",
      }),
    ).toMatchObject({
      "business-type": "0",
      "cache-control": "no-cache",
      "content-type": "application/json",
      debug: "0",
      need_decrypt: "1",
      "ninebot-version": "2",
      platform: "Android",
      "platform-ver": "13",
      "service-time": "1725000000000",
    });
  });

  it("uses the shared encrypted envelope and business path", () => {
    const request = buildBusinessLoginEncryptedRequest({
      fields,
      timeStamp: 1_725_000_000,
    });
    expect(request.envelope).toMatchObject({ p: "101", t: "0" });
    expect(request.envelope.d).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(businessLoginPath).toBe("/user/user/login");
  });
});
