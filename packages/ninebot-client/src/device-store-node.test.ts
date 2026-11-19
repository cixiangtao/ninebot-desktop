import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileNinebotDeviceContextStore } from "./device-store-node.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("file device context store", () => {
  it("uses observed Android defaults rather than host OS metadata on a fresh install", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ninebot-device-store-"));
    directories.push(directory);
    await expect(createFileNinebotDeviceContextStore({ directory }).load()).resolves.toMatchObject({
      osVersion: "13",
      osModel: "Xiaomi",
      region: "bj",
    });
  });
  it("generates and persists SDK-owned metadata when no legacy config exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ninebot-device-store-"));
    directories.push(directory);
    const store = createFileNinebotDeviceContextStore({
      directory,
      deviceIdFactory: () => "generated-device",
      defaults: { region: "bj", osVersion: "14", osModel: "test" },
    });

    await expect(store.load()).resolves.toEqual({
      deviceId: "generated-device",
      region: "bj",
      osVersion: "14",
      osModel: "test",
    });
    await expect(readFile(join(directory, "device-context.json"), "utf8")).resolves.toContain(
      '"deviceId":"generated-device"',
    );
    await expect(stat(join(directory, "device-context.json"))).resolves.toMatchObject({
      mode: 0o100600,
    });
  });

  it("reads legacy ninecli config without rewriting it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ninebot-device-store-"));
    directories.push(directory);
    const legacy = JSON.stringify({
      device_id: "legacy-device",
      region: "sh",
      os_version: "13",
      os_model: "phone",
    });
    await writeFile(join(directory, "config.json"), legacy);
    const store = createFileNinebotDeviceContextStore({ directory });

    await expect(store.load()).resolves.toEqual({
      deviceId: "legacy-device",
      region: "sh",
      osVersion: "13",
      osModel: "phone",
    });
    await expect(readFile(join(directory, "config.json"), "utf8")).resolves.toBe(legacy);
  });
});
