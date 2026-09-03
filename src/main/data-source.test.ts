import { describe, expect, it } from "vitest";
import { isCandidateSourceEnabled, resolveCandidateSource } from "./data-source.js";

describe("candidate source selection", () => {
  it("keeps every domain on ninecli by default", () => {
    expect(isCandidateSourceEnabled({}, "vehicle")).toBe(false);
    expect(isCandidateSourceEnabled({}, "telemetry")).toBe(false);
    expect(isCandidateSourceEnabled({}, "travel")).toBe(false);
  });

  it("enables all domains with the umbrella candidate switch", () => {
    const environment = { NINEBOT_SOURCE: "candidate" };
    expect(isCandidateSourceEnabled(environment, "vehicle")).toBe(true);
    expect(isCandidateSourceEnabled(environment, "telemetry")).toBe(true);
    expect(isCandidateSourceEnabled(environment, "travel")).toBe(true);
  });

  it("lets a domain-specific value override the umbrella switch", () => {
    const environment = {
      NINEBOT_SOURCE: "candidate",
      NINEBOT_TRAVEL_SOURCE: "ninecli",
    };
    expect(isCandidateSourceEnabled(environment, "vehicle")).toBe(true);
    expect(isCandidateSourceEnabled(environment, "travel")).toBe(false);
  });

  it("fails closed when a domain-specific value is unknown", () => {
    const environment = {
      NINEBOT_SOURCE: "candidate",
      NINEBOT_TRAVEL_SOURCE: "candidte",
    };
    expect(isCandidateSourceEnabled(environment, "travel")).toBe(false);
  });

  it("enables one domain without enabling the others", () => {
    const environment = { NINEBOT_TELEMETRY_SOURCE: "candidate" };
    expect(isCandidateSourceEnabled(environment, "vehicle")).toBe(false);
    expect(isCandidateSourceEnabled(environment, "telemetry")).toBe(true);
    expect(isCandidateSourceEnabled(environment, "travel")).toBe(false);
  });

  it("returns a stable renderer-safe source label", () => {
    const environment = {
      NINEBOT_SOURCE: "candidate",
      NINEBOT_TRAVEL_SOURCE: "ninecli",
    };
    expect(resolveCandidateSource(environment, "vehicle")).toBe("candidate");
    expect(resolveCandidateSource(environment, "travel")).toBe("ninecli");
  });
});
