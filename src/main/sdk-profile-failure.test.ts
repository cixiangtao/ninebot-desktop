import { describe, expect, it } from "vitest";
import {
  PassportLoginBusinessError,
  PassportLoginHttpError,
  NinebotAuthSessionUnavailableError,
} from "@jiuhao/ninebot-client/node";
import { classifyProfileFailure, sanitizeProfileFailure } from "./sdk-profile-failure.js";

describe("profile failure classification without request or response material", () => {
  it("distinguishes a local signer failure before transport", () => {
    expect(
      classifyProfileFailure(new Error("Web Crypto SHA-256 is unavailable in this runtime")),
    ).toMatchObject({ kind: "runtime", reason: "webcrypto-unavailable" });
  });
  it.each([401, 403, 503])("retains only HTTP status %s", (status) => {
    expect(classifyProfileFailure(new PassportLoginHttpError(status))).toMatchObject({
      kind: "http",
      httpStatus: status,
    });
  });
  it("classifies protocol, session and transport failures", () => {
    expect(classifyProfileFailure(new SyntaxError("synthetic-private"))).toMatchObject({
      kind: "protocol",
    });
    expect(classifyProfileFailure(new NinebotAuthSessionUnavailableError())).toMatchObject({
      kind: "session",
    });
    expect(
      classifyProfileFailure(new TypeError("synthetic-private", { cause: { code: "ENOTFOUND" } })),
    ).toMatchObject({ kind: "transport", reason: "dns" });
  });
  it("retains a bounded business code but never description text", () => {
    const failure = classifyProfileFailure(
      new PassportLoginBusinessError(90017, "synthetic-private", "resultCode", "desc"),
    );
    expect(failure).toMatchObject({ kind: "business", businessCode: 90017 });
    expect(JSON.stringify(failure)).not.toContain("synthetic-private");
  });
  it("drops unrecognized diagnostic fields and enum values", () => {
    expect(
      sanitizeProfileFailure({
        kind: "synthetic-private",
        reason: "synthetic-private",
        httpStatus: "synthetic-private",
        accessToken: "synthetic-private",
      }),
    ).toEqual({ kind: "unknown", reason: "unknown", httpStatus: null, businessCode: null });
  });
  it("separates invalid protocol, service configuration, timeout and local exceptions", () => {
    expect(
      classifyProfileFailure(new Error("Ninebot passport response has an invalid code")),
    ).toMatchObject({ kind: "protocol", reason: "invalid-response" });
    expect(
      classifyProfileFailure(new Error("Missing origin for Ninebot service: synthetic")),
    ).toMatchObject({ kind: "configuration", reason: "origin-unavailable" });
    expect(
      classifyProfileFailure(new Error("Ninebot fetch timed out after 15000 ms")),
    ).toMatchObject({ kind: "transport", reason: "timeout" });
    expect(classifyProfileFailure(new TypeError("synthetic-private"))).toMatchObject({
      kind: "runtime",
      reason: "runtime-exception",
    });
  });
});
