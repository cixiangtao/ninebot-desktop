import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NinebotCandidateSessionFields } from "@jiuhao/ninebot-client/candidate-session";
import {
  createFileNinebotDeviceContextStore,
  createFileNinebotVehicleCacheStore,
} from "@jiuhao/ninebot-client";

export type CandidateService = "ebike" | "motor";

export interface CandidateRequestHandle {
  signal: AbortSignal;
  release: () => void;
}

export interface CandidateRequestTracker {
  start: () => CandidateRequestHandle;
  clear: () => void;
}

/** Creates a request tracker that can cancel work even while session files are loading. */
export const createCandidateRequestTracker = (): CandidateRequestTracker => {
  const activeRequests = new Set<AbortController>();
  return {
    start: () => {
      const controller = new AbortController();
      activeRequests.add(controller);
      return {
        signal: controller.signal,
        release: () => activeRequests.delete(controller),
      };
    },
    clear: () => {
      for (const controller of activeRequests) {
        controller.abort(new Error("Ninebot candidate request was cancelled"));
      }
      activeRequests.clear();
    },
  };
};

interface CandidateConfig {
  device_id: string;
  deviceId?: string;
  region: string;
  os_version: string;
  osVersion?: string;
  os_model: string;
  osModel?: string;
}

interface CandidateTokens {
  access_token: string;
  business_uid: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));

const readJsonIfPresent = async (path: string): Promise<unknown | null> => {
  try {
    return await readJson(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

const requireText = (value: unknown, label: string) => {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).length === 0) {
    throw new Error(`Ninebot ${label} is incomplete`);
  }
  return String(value);
};

/** Resolves the service family from either ninecli's textual or numeric field. */
export const readCandidateService = (
  value:
    | {
        business_line?: unknown;
        businessType?: unknown;
      }
    | null
    | undefined,
): CandidateService | null => {
  if (value?.business_line === "ebike" || value?.business_line === "motor") {
    return value.business_line;
  }
  if (value?.businessType === 1 || value?.businessType === "1") return "motor";
  if (value?.businessType === 2 || value?.businessType === "2") return "ebike";
  return null;
};

/** Reads the local session files and builds the shared in-memory candidate fields. */
export const readCandidateSession = async (
  configDirectory: string,
): Promise<NinebotCandidateSessionFields> => {
  const [configValue, authSessionValue] = await Promise.all([
    createFileNinebotDeviceContextStore({ directory: configDirectory }).load(),
    readJsonIfPresent(join(configDirectory, "auth-session.json")),
  ]);
  const tokensValue = authSessionValue ?? (await readJson(join(configDirectory, "tokens.json")));
  if (!isRecord(configValue) || !isRecord(tokensValue)) {
    throw new Error("Ninebot candidate session files are invalid");
  }
  const config = configValue as unknown as Partial<CandidateConfig>;
  const tokens = tokensValue as Partial<CandidateTokens> & {
    accessToken?: unknown;
    businessUid?: unknown;
  };
  return {
    sys_language: "zh-hans-cn",
    client_ver: "610063322",
    device_id: requireText(config.deviceId ?? config.device_id, "candidate device_id"),
    regionx: requireText(config.region, "candidate region"),
    language: "zh",
    ostype: "and",
    lang: "zh",
    platform_ver: `${requireText(config.osVersion ?? config.os_version, "candidate os_version")} ${requireText(config.osModel ?? config.os_model, "candidate os_model")}`,
    platform: "android",
    login_country: "CN",
    access_token: requireText(tokens.accessToken ?? tokens.access_token, "candidate access_token"),
    uid: requireText(tokens.businessUid ?? tokens.business_uid, "candidate business_uid"),
  };
};

/** Reads the cached vehicle metadata needed to resolve a candidate service. */
export const readCandidateVehicles = async (configDirectory: string): Promise<unknown> =>
  (await createFileNinebotVehicleCacheStore({ directory: configDirectory }).load()) ??
  (() => {
    throw new Error("Ninebot candidate vehicle cache is unavailable");
  })();

/** Stores only the SDK vehicle metadata needed to resolve service families and model codes. */
export const writeCandidateVehicles = async (configDirectory: string, value: unknown) => {
  await createFileNinebotVehicleCacheStore({ directory: configDirectory }).save(value);
};
