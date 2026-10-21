import { mkdtemp, readFile, rm, stat, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFileRuntimeDiagnostics,
  createRuntimeDiagnosticCollector,
  type RuntimeDiagnosticEvent,
} from "./runtime-diagnostics.js";
import { SessionReadCache } from "./session-read-cache.js";

describe("bounded non-secret runtime diagnostics", () => {
  it("drops extra fields, keeps only states and preserves ordered counters after journal truncation", () => {
    const collector = createRuntimeDiagnosticCollector(() => 123);
    collector.record({
      category: "auth",
      event: {
        kind: "eligibility",
        source: "restore",
        status: "fresh",
        refreshSupported: true,
        nextEligibleAtMs: 999,
        accessToken: "NEVER-LOG",
      },
      password: "NEVER-LOG",
    } as RuntimeDiagnosticEvent);
    for (let index = 0; index < 100; index += 1)
      collector.record({
        category: "read",
        operation: "ride-month",
        outcome: "completed",
        response: { longitude: "NEVER-LOG" },
      } as RuntimeDiagnosticEvent);
    const snapshot = collector.snapshot();
    expect(snapshot.latestEligibility?.decision.nextEligibleAtMs).toBe(999);
    expect(snapshot.processId).toBe(process.pid);
    expect(snapshot.collectorStartedAtMs).toBe(123);
    expect(snapshot.sequence).toBe(101);
    expect(snapshot.events).toHaveLength(64);
    expect(snapshot.signals["auth.eligibility.fresh"]?.count).toBe(1);
    expect(snapshot.signals["read.ride-month.completed"]).toEqual({
      count: 100,
      lastSequence: 101,
      lastObservedAtMs: 123,
    });
    expect(JSON.stringify(snapshot)).not.toContain("NEVER-LOG");
    snapshot.signals["read.ride-month.completed"]!.count = -1;
    expect(collector.snapshot().signals["read.ride-month.completed"]?.count).toBe(100);
  });

  it("persists only bounded profile failure fields", () => {
    const collector = createRuntimeDiagnosticCollector(() => 123);
    collector.record({
      category: "profile-failure",
      failure: {
        kind: "http",
        reason: "http-rejected",
        httpStatus: 503,
        businessCode: null,
        response: "NEVER-LOG",
        accessToken: "NEVER-LOG",
      },
    } as RuntimeDiagnosticEvent);
    expect(collector.snapshot().signals["profile-failure.http.http-rejected"]?.count).toBe(1);
    expect(JSON.stringify(collector.snapshot())).not.toContain("NEVER-LOG");
  });

  it("does not create files when disabled, writes atomic private snapshots when enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "runtime-diagnostic-test-"));
    try {
      const off = createFileRuntimeDiagnostics({
        directory: join(root, "disabled"),
        enabled: false,
      });
      off.record({ category: "read", operation: "ride-detail", outcome: "completed" });
      expect(await off.flush()).toBe(true);
      await expect(access(join(root, "disabled"))).rejects.toThrow();
      const directory = join(root, "enabled");
      const writer = createFileRuntimeDiagnostics({ directory, enabled: true });
      writer.record({ category: "read", operation: "ride-detail", outcome: "completed" });
      expect(await writer.flush()).toBe(true);
      const file = join(directory, "runtime-diagnostics.json");
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(
        JSON.parse(await readFile(file, "utf8")).signals["read.ride-detail.completed"].count,
      ).toBe(1);
      writer.record({ category: "read", operation: "ride-detail", outcome: "failed" });
      expect(await writer.flush()).toBe(true);
      expect(JSON.parse(await readFile(file, "utf8")).sequence).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports a sink write failure without throwing into the product", async () => {
    const root = await mkdtemp(join(tmpdir(), "runtime-diagnostic-failure-"));
    try {
      const file = join(root, "not-a-directory");
      await writeFile(file, "sentinel");
      const writer = createFileRuntimeDiagnostics({ directory: file, enabled: true });
      writer.record({ category: "read", operation: "ride-month", outcome: "failed" });
      expect(await writer.flush()).toBe(false);
      expect(await readFile(file, "utf8")).toBe("sentinel");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records cache joins and discarded stale loads without keys or result values", async () => {
    const outcomes: string[] = [];
    const cache = new SessionReadCache<number>(
      () => 0,
      (outcome) => outcomes.push(outcome),
    );
    let finish!: (value: number) => void;
    const first = cache.read(
      "private-cache-key",
      100,
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const second = cache.read("private-cache-key", 100, async () => 99);
    cache.clear();
    finish(7);
    expect(await first).toBe(7);
    expect(await second).toBe(7);
    expect(outcomes).toEqual(["upstream-started", "joined", "discarded"]);
    expect(outcomes).not.toContain("upstream-completed");
    expect(JSON.stringify(outcomes)).not.toContain("private-cache-key");
  });
});
