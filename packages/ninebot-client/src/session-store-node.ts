import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NinebotAuthSession, NinebotAuthSessionStore } from "./auth.ts";

export interface FileNinebotAuthSessionStoreOptions {
  directory: string;
  /** New-format file written by this store. */
  fileName?: string;
  /** Optional legacy ninecli token file read only when the new file is absent. */
  legacyFileName?: string;
}

const defaultFileName = "auth-session.json";
const defaultLegacyFileName = "tokens.json";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readText = (value: unknown, key: string) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Ninebot auth session field ${key} is invalid`);
  }
  return value;
};

const readExpiry = (value: unknown) => {
  if (value === undefined || value === null) return undefined;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Ninebot auth session field expiresAtMs is invalid");
  }
  return parsed < 1_000_000_000_000 ? parsed * 1_000 : parsed;
};

const parseSessionFile = (value: unknown): NinebotAuthSession => {
  if (!isRecord(value)) throw new Error("Ninebot auth session file must contain an object");
  const accessToken = value.accessToken ?? value.access_token;
  const businessUid = value.businessUid ?? value.business_uid;
  const session: NinebotAuthSession = {
    accessToken: readText(accessToken, "accessToken"),
    businessUid: readText(businessUid, "businessUid"),
  };
  const uuid = value.uuid;
  if (uuid !== undefined) session.uuid = readText(uuid, "uuid");
  const expiresAtMs =
    value.expiresAtMs !== undefined
      ? (() => {
          if (
            typeof value.expiresAtMs !== "number" ||
            !Number.isFinite(value.expiresAtMs) ||
            value.expiresAtMs <= 0
          ) {
            throw new Error("Ninebot auth session field expiresAtMs is invalid");
          }
          return value.expiresAtMs;
        })()
      : readExpiry(value.accessTokenValidity);
  if (expiresAtMs !== undefined) session.expiresAtMs = expiresAtMs;
  if (value.refreshToken !== undefined) {
    session.refreshToken = readText(value.refreshToken, "refreshToken");
  }
  return session;
};

const readSessionFile = async (path: string): Promise<NinebotAuthSession | null> => {
  try {
    const content = await readFile(path, "utf8");
    return parseSessionFile(JSON.parse(content) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

/**
 * Stores only the session material needed by the SDK, using an atomic restricted file.
 *
 * When the new file is absent, an optional legacy ninecli token file can be read without
 * modifying it. Saving always uses the new camelCase file, allowing a later migration
 * step to remove the legacy runtime without losing an existing account session.
 */
export const createFileNinebotAuthSessionStore = ({
  directory,
  fileName = defaultFileName,
  legacyFileName = defaultLegacyFileName,
}: FileNinebotAuthSessionStoreOptions): NinebotAuthSessionStore => {
  const sessionPath = join(directory, fileName);
  const legacyPath = join(directory, legacyFileName);

  return {
    async load() {
      const current = await readSessionFile(sessionPath);
      return current ?? (sessionPath === legacyPath ? null : readSessionFile(legacyPath));
    },
    async save(session) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const tempPath = `${sessionPath}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(tempPath, `${JSON.stringify(session)}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
        await chmod(tempPath, 0o600);
        await rename(tempPath, sessionPath);
      } finally {
        await rm(tempPath, { force: true });
      }
    },
    async clear() {
      await rm(sessionPath, { force: true });
    },
  };
};
