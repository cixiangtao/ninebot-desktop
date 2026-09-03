import { describe, expect, it } from "vitest";
import {
  buildPasswordLoginRequest,
  buildPassportCanonicalString,
  defaultPassportClientKey,
  parsePassportLoginSession,
} from "./passport-auth.ts";

describe("Passport password-login boundary", () => {
  it("builds the observed request body and delegates signing", async () => {
    const request = await buildPasswordLoginRequest({
      areaCode: "+86",
      username: "probe-user",
      password: "probe-password",
      timestampMs: 1_788_418_017_341,
      signer: () => "signature",
    });

    expect(request).toMatchObject({
      service: "passport",
      method: "POST",
      path: "/v6/user/login",
      headers: {
        "content-type": "application/json; charset=UTF-8",
        clientid: "vehicle_app_prod",
        timestamp: "1788418017341",
        sign: "signature",
      },
    });
    expect(new TextDecoder().decode(request.body)).toBe(
      '{"areaCode":"+86","device":"ANDROID","password":"probe-password","username":"probe-user"}',
    );
  });

  it("reconstructs the exact sorted canonical string observed in ninecli", () => {
    const body = new TextEncoder().encode(
      '{"areaCode":"+86","device":"ANDROID","password":"probe-password","username":"probe-user"}',
    );
    expect(
      buildPassportCanonicalString({
        path: "/v6/user/login",
        timestamp: "1788418017341",
        clientKey: defaultPassportClientKey,
        appVersion: "610063322",
        os: "Android",
        osLanguage: "zh-hans-cn",
        osVersion: "13",
        body,
      }),
    ).toBe(
      "app_version=610063322&areaCode=+86&clientKey=e177176a-3b3e-1513-e26e-d1123034cb66&device=ANDROID&os=Android&os_language=zh-hans-cn&os_version=13&password=probe-password&timestamp=1788418017341&url=/v6/user/login&username=probe-user",
    );
  });

  it("normalizes the observed token fields without retaining unrelated response data", () => {
    expect(
      parsePassportLoginSession({
        access_token: "access",
        refresh_token: "refresh",
        business_uid: "business",
        phone: "+8613800000000",
      }),
    ).toEqual({ accessToken: "access", refreshToken: "refresh", businessUid: "business" });
  });

  it("rejects a login response that cannot drive business requests", () => {
    expect(() => parsePassportLoginSession({ access_token: "access" })).toThrow(
      "refresh_token is invalid",
    );
  });
});
