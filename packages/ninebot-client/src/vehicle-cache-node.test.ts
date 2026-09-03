import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileNinebotVehicleCacheStore } from "./vehicle-cache-node.ts";

const directories: string[] = [];

afterEach(async () => {
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
