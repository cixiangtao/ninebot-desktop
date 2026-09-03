import { describe, expect, it } from "vitest";
import { isCandidateSourceEnabled, resolveCandidateSource } from "./data-source.js";

describe("candidate source selection", () => {
  it("uses the TypeScript SDK for every domain by default", () => {
    expect(isCandidateSourceEnabled({}, "vehicle")).toBe(true);
    expect(isCandidateSourceEnabled({}, "telemetry")).toBe(true);
    expect(isCandidateSourceEnabled({}, "travel")).toBe(true);
  });

  it("keeps every domain on the SDK even when legacy switches are present", () => {
    const environment = {
      NINEBOT_SOURCE: "ninecli",
      NINEBOT_TRAVEL_SOURCE: "ninecli",
      NINEBOT_TELEMETRY_SOURCE: "unknown",
    };
    expect(isCandidateSourceEnabled(environment, "vehicle")).toBe(true);
    expect(isCandidateSourceEnabled(environment, "telemetry")).toBe(true);
    expect(isCandidateSourceEnabled(environment, "travel")).toBe(true);
  });

  it("returns a stable renderer-safe source label", () => {
    const environment = { NINEBOT_SOURCE: "ninecli" };
    expect(resolveCandidateSource(environment, "vehicle")).toBe("candidate");
    expect(resolveCandidateSource(environment, "travel")).toBe("candidate");
  });
});
