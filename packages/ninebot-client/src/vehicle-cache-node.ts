import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface FileNinebotVehicleCacheStoreOptions {
  directory: string;
  fileName?: string;
  /** Non-credential identity. Scoped stores never read ownerless or legacy files. */
  scope?: { businessUid: string; region: string };
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

const writeAtomic = async (path: string, value: unknown, signal?: AbortSignal) => {
  signal?.throwIfAborted();
  const directory = join(path, "..");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    signal?.throwIfAborted();
    await writeFile(temporaryPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    signal?.throwIfAborted();
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
};

/** Persists SDK-owned vehicle metadata without storing credentials or raw telemetry. */
export const createFileNinebotVehicleCacheStore = ({
  directory,
  fileName = "vehicle-cache.json",
  scope,
  legacyFileName = "vehicles.json",
}: FileNinebotVehicleCacheStoreOptions) => {
  if (scope && (!scope.businessUid.trim() || !scope.region.trim()))
    throw new Error("Ninebot vehicle cache scope is incomplete");
  // A separate private file prevents even an uncancellable old-account rename
  // from replacing another account's metadata. Tokens never participate in identity.
  const identity = scope
    ? createHash("sha256")
        .update(JSON.stringify([scope.businessUid, scope.region]))
        .digest("hex")
    : null;
  const path = join(directory, identity ? `${fileName}.${identity}` : fileName);
  const legacyPath = join(directory, legacyFileName);
  return {
    async load(): Promise<unknown | null> {
      return (
        (await readIfPresent(path)) ??
        (scope || path === legacyPath ? null : readIfPresent(legacyPath))
      );
    },
    async save(value: unknown, { signal }: { signal?: AbortSignal } = {}) {
      await writeAtomic(path, value, signal);
    },
    async clear() {
      await rm(path, { force: true });
    },
  };
};

export type NinebotVehicleCacheStore = ReturnType<typeof createFileNinebotVehicleCacheStore>;
