import { describe, expect, it } from "vitest";
import {
  candidateRequestTimeoutMs,
  defaultCandidateRequestTimeoutMs,
  maxCandidateRequestTimeoutMs,
  resolveCandidateRequestTimeoutMs,
} from "./candidate-client.js";

describe("candidate request timeout", () => {
  it("uses the safe default when no override is configured", () => {
    expect(resolveCandidateRequestTimeoutMs({})).toBe(defaultCandidateRequestTimeoutMs);
  });

  it("accepts a positive integer override", () => {
    expect(resolveCandidateRequestTimeoutMs({ NINEBOT_CANDIDATE_TIMEOUT_MS: "30000" })).toBe(
      30_000,
    );
  });

  it("trims whitespace around an override", () => {
    expect(resolveCandidateRequestTimeoutMs({ NINEBOT_CANDIDATE_TIMEOUT_MS: " 45000 " })).toBe(
      45_000,
    );
  });

  it("falls back for malformed or non-positive values", () => {
    for (const value of ["", "  ", "0", "-1", "1.5", "fast", "Infinity"]) {
      expect(resolveCandidateRequestTimeoutMs({ NINEBOT_CANDIDATE_TIMEOUT_MS: value })).toBe(
        defaultCandidateRequestTimeoutMs,
      );
    }
  });

  it("clamps values above the safety cap", () => {
    expect(resolveCandidateRequestTimeoutMs({ NINEBOT_CANDIDATE_TIMEOUT_MS: "999999" })).toBe(
      maxCandidateRequestTimeoutMs,
    );
  });

  it("keeps the exported runtime timeout within the safety cap", () => {
    expect(candidateRequestTimeoutMs).toBeGreaterThan(0);
    expect(candidateRequestTimeoutMs).toBeLessThanOrEqual(maxCandidateRequestTimeoutMs);
  });
});
