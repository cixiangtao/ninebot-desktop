import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface FileNinebotVehicleCacheStoreOptions {
  directory: string;
  fileName?: string;
  /** Read-only compatibility fallback for an existing ninecli vehicle cache. */
  legacyFileName?: string;
}

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

/** Persists SDK-owned vehicle metadata without storing credentials or raw telemetry. */
export const createFileNinebotVehicleCacheStore = ({
  directory,
  fileName = "vehicle-cache.json",
  legacyFileName = "vehicles.json",
}: FileNinebotVehicleCacheStoreOptions) => {
  const path = join(directory, fileName);
  const legacyPath = join(directory, legacyFileName);
  return {
    async load(): Promise<unknown | null> {
      return (
        (await readIfPresent(path)) ?? (path === legacyPath ? null : readIfPresent(legacyPath))
      );
    },
    async save(value: unknown) {
      await writeAtomic(path, value);
    },
    async clear() {
      await rm(path, { force: true });
    },
  };
};

export type NinebotVehicleCacheStore = ReturnType<typeof createFileNinebotVehicleCacheStore>;
