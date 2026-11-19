import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFileNinebotVehicleCacheStore } from "./vehicle-cache-node.ts";

// Inject cancellation after the real temporary file is written and chmodded,
// without depending on how many cancellation checkpoints the store uses.
const hooks = vi.hoisted(() => ({ afterChmod: null as (() => void) | null }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    chmod: async (...args: Parameters<typeof fs.chmod>) => {
      await fs.chmod(...args);
      hooks.afterChmod?.();
    },
  };
});
const directories: string[] = [];

afterEach(async () => {
  hooks.afterChmod = null;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("file vehicle cache store", () => {
  it("prefers and writes the SDK-owned cache file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ninebot-vehicle-cache-"));
    directories.push(directory);
    const store = createFileNinebotVehicleCacheStore({ directory });
    const value = { vehicles: [{ wnumber: "SN1", vehicle_type: 14363 }] };

    await store.save(value);

    await expect(store.load()).resolves.toEqual(value);
    await expect(readFile(join(directory, "vehicle-cache.json"), "utf8")).resolves.toContain(
      '"vehicle_type":14363',
    );
  });

  it("falls back to a legacy cache without modifying it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ninebot-vehicle-cache-"));
    directories.push(directory);
    const legacy = JSON.stringify({ vehicles: [{ wnumber: "SN1" }] });
    await writeFile(join(directory, "vehicles.json"), legacy);
    const store = createFileNinebotVehicleCacheStore({ directory });

    await expect(store.load()).resolves.toEqual({ vehicles: [{ wnumber: "SN1" }] });
    await expect(readFile(join(directory, "vehicles.json"), "utf8")).resolves.toBe(legacy);
  });
});

describe("account and region scoped metadata (synthetic only)", () => {
  const scope = { businessUid: "synthetic-a", region: "bj" };
  const setup = async () => {
    const directory = await mkdtemp(join(tmpdir(), "ninebot-scoped-metadata-"));
    directories.push(directory);
    return directory;
  };
  it("isolates accounts and regions, including a delayed write from another account", async () => {
    const directory = await setup();
    const a = createFileNinebotVehicleCacheStore({ directory, scope });
    const b = createFileNinebotVehicleCacheStore({
      directory,
      scope: { ...scope, businessUid: "synthetic-b" },
    });
    const eu = createFileNinebotVehicleCacheStore({ directory, scope: { ...scope, region: "eu" } });
    await b.save({ vehicles: ["synthetic-b"] });
    await a.save({ vehicles: ["synthetic-a-late"] });
    await expect(a.load()).resolves.toEqual({ vehicles: ["synthetic-a-late"] });
    await expect(b.load()).resolves.toEqual({ vehicles: ["synthetic-b"] });
    await expect(eu.load()).resolves.toBeNull();
    await a.clear();
    await expect(b.load()).resolves.toEqual({ vehicles: ["synthetic-b"] });
  });
  it("ignores both ownerless SDK and legacy caches without modifying them", async () => {
    const directory = await setup();
    const previous = JSON.stringify({ vehicles: ["synthetic-previous"] });
    await writeFile(join(directory, "vehicles.json"), previous);
    await writeFile(join(directory, "vehicle-cache.json"), previous);
    const store = createFileNinebotVehicleCacheStore({ directory, scope });
    await expect(store.load()).resolves.toBeNull();
    await store.save({ vehicles: [] });
    await expect(store.load()).resolves.toEqual({ vehicles: [] });
    expect(await readFile(join(directory, "vehicles.json"), "utf8")).toBe(previous);
    expect(await readFile(join(directory, "vehicle-cache.json"), "utf8")).toBe(previous);
  });
  it("does not save an already cancelled result", async () => {
    const directory = await setup();
    const store = createFileNinebotVehicleCacheStore({ directory, scope });
    await store.save({ vehicles: ["synthetic-current"] });
    const controller = new AbortController();
    controller.abort(new Error("synthetic cancelled"));
    await expect(
      store.save({ vehicles: ["synthetic-late"] }, { signal: controller.signal }),
    ).rejects.toThrow("synthetic cancelled");
    await expect(store.load()).resolves.toEqual({ vehicles: ["synthetic-current"] });
  });
  it("cancels before atomic commit, preserves the old file and cleans temporary data", async () => {
    const directory = await setup();
    const store = createFileNinebotVehicleCacheStore({ directory, scope });
    await store.save({ vehicles: ["synthetic-current"] });
    const before = await readdir(directory);
    const controller = new AbortController();
    hooks.afterChmod = () => controller.abort(new Error("synthetic commit cancelled"));
    await expect(
      store.save({ vehicles: ["synthetic-late"] }, { signal: controller.signal }),
    ).rejects.toThrow("synthetic commit cancelled");
    await expect(store.load()).resolves.toEqual({ vehicles: ["synthetic-current"] });
    expect(await readdir(directory)).toEqual(before);
    if (process.platform !== "win32")
      expect((await stat(join(directory, before[0]!))).mode & 0o777).toBe(0o600);
  });
  it("rejects incomplete scope instead of silently loading an unscoped cache", async () => {
    const directory = await setup();
    expect(() =>
      createFileNinebotVehicleCacheStore({ directory, scope: { ...scope, businessUid: "" } }),
    ).toThrow(/scope/i);
    expect(() =>
      createFileNinebotVehicleCacheStore({ directory, scope: { ...scope, region: " " } }),
    ).toThrow(/scope/i);
  });
});
