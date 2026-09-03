import { describe, expect, it } from "vitest";
import { compareNinebotPayloads } from "./parity-node.ts";

describe("Ninebot local parity report", () => {
  it("reports equal JSON-like payloads without including values", () => {
    const report = compareNinebotPayloads(
      { code: 1, data: [{ speed: 53, token: "PRIVATE-TOKEN" }] },
      { data: [{ token: "PRIVATE-TOKEN", speed: 53 }], code: 1 },
    );
    expect(report).toMatchObject({ equal: true, truncated: false });
    expect(JSON.stringify(report)).not.toContain("PRIVATE-TOKEN");
  });

  it("returns field paths, types, lengths, and reasons for differences", () => {
    const report = compareNinebotPayloads(
      { data: [{ speed: 53, stale: true }], desc: "ok" },
      { data: [{ speed: "53" }], desc: "error" },
    );
    expect(report.equal).toBe(false);
    expect(report.differences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "$.data[0].speed", reason: "type-mismatch" }),
        expect.objectContaining({ path: "$.data[0].stale", reason: "missing-in-candidate" }),
        expect.objectContaining({ path: "$.desc", reason: "value-mismatch" }),
      ]),
    );
  });

  it("marks bounded comparisons as truncated instead of claiming parity", () => {
    const report = compareNinebotPayloads(
      { data: [1, 2, 3] },
      { data: [1, 2, 3] },
      { maxArrayItems: 2 },
    );
    expect(report).toMatchObject({ equal: false, truncated: true });
  });

  it("rejects unsafe comparison limits", () => {
    expect(() => compareNinebotPayloads([], [], { maxArrayItems: -1 })).toThrow("maxArrayItems");
    expect(() => compareNinebotPayloads({}, {}, { maxDepth: 1.5 })).toThrow("maxDepth");
    expect(() => compareNinebotPayloads({}, {}, { maxDifferences: 0 })).toThrow("maxDifferences");
  });
});
