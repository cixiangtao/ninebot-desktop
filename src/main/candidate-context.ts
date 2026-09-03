import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NinebotCandidateSessionFields } from "@jiuhao/ninebot-client/candidate-session";

interface CandidateConfig {
  device_id: string;
  region: string;
  os_version: string;
  os_model: string;
}

interface CandidateTokens {
  access_token: string;
  business_uid: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));

const requireText = (value: unknown, label: string) => {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).length === 0) {
    throw new Error(`Ninebot ${label} is incomplete`);
  }
  return String(value);
};

/** Reads the local session files and builds the shared in-memory candidate fields. */
export const readCandidateSession = async (
  configDirectory: string,
): Promise<NinebotCandidateSessionFields> => {
  const [configValue, tokensValue] = await Promise.all([
    readJson(join(configDirectory, "config.json")),
    readJson(join(configDirectory, "tokens.json")),
  ]);
  if (!isRecord(configValue) || !isRecord(tokensValue)) {
    throw new Error("Ninebot candidate session files are invalid");
  }
  const config = configValue as Partial<CandidateConfig>;
  const tokens = tokensValue as Partial<CandidateTokens>;
  return {
    sys_language: "zh-hans-cn",
    client_ver: "610063322",
    device_id: requireText(config.device_id, "candidate device_id"),
    regionx: requireText(config.region, "candidate region"),
    language: "zh",
    ostype: "and",
    lang: "zh",
    platform_ver: `${requireText(config.os_version, "candidate os_version")} ${requireText(config.os_model, "candidate os_model")}`,
    platform: "android",
    login_country: "CN",
    access_token: requireText(tokens.access_token, "candidate access_token"),
    uid: requireText(tokens.business_uid, "candidate business_uid"),
  };
};

/** Reads the cached vehicle metadata needed to resolve a candidate service. */
export const readCandidateVehicles = async (configDirectory: string): Promise<unknown> =>
  readJson(join(configDirectory, "vehicles.json"));
