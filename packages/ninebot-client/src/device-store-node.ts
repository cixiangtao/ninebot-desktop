import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Non-secret device metadata used to shape Android-compatible requests. */
export interface NinebotDeviceContext {
  deviceId: string;
  region: string;
  osVersion: string;
  osModel: string;
}

export interface FileNinebotDeviceContextStoreOptions {
  directory: string;
  fileName?: string;
  /** Read-only compatibility fallback for an existing ninecli config. */
  legacyFileName?: string;
  deviceIdFactory?: () => string;
  defaults?: Partial<Omit<NinebotDeviceContext, "deviceId">>;
}

const parseContext = (value: unknown): NinebotDeviceContext => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Ninebot device context file must contain an object");
  }
  const record = value as Record<string, unknown>;
  return {
    deviceId: readContextText(record.deviceId ?? record.device_id, "deviceId"),
    region: readContextText(record.region, "region"),
    osVersion: readContextText(record.osVersion ?? record.os_version, "osVersion"),
    osModel: readContextText(record.osModel ?? record.os_model, "osModel"),
  };
};

const readContextText = (current: unknown, key: string) => {
  if (typeof current !== "string" || current.trim() === "") {
    throw new Error(`Ninebot device context field ${key} is invalid`);
  }
  return current;
};

const readIfPresent = async (path: string): Promise<unknown | null> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

const writeAtomic = async (path: string, value: unknown) => {
  const directory = join(path, "..");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

/**
 * Persists SDK device metadata and reads an existing legacy config without rewriting it.
 * New contexts use the Android protocol defaults observed in ninecli, not host OS values.
 */
export const createFileNinebotDeviceContextStore = ({
  directory,
  fileName = "device-context.json",
  legacyFileName = "config.json",
  deviceIdFactory = () => randomUUID().replaceAll("-", ""),
  defaults = {},
}: FileNinebotDeviceContextStoreOptions) => {
  const path = join(directory, fileName);
  const legacyPath = join(directory, legacyFileName);
  const generated: NinebotDeviceContext = {
    deviceId: deviceIdFactory(),
    region: defaults.region ?? "bj",
    osVersion: defaults.osVersion ?? "13",
    osModel: defaults.osModel ?? "Xiaomi",
  };

  return {
    async load(): Promise<NinebotDeviceContext> {
      const current = await readIfPresent(path);
      if (current !== null) return parseContext(current);
      const legacy = await readIfPresent(legacyPath);
      if (legacy !== null) return parseContext(legacy);
      await writeAtomic(path, generated);
      return { ...generated };
    },
    async save(context: NinebotDeviceContext) {
      await writeAtomic(path, parseContext(context));
    },
    async clear() {
      await rm(path, { force: true });
    },
  };
};

export type NinebotDeviceContextStore = ReturnType<typeof createFileNinebotDeviceContextStore>;
