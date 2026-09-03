import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createNinebotCandidateSessionClient,
  type NinebotCandidateSessionFields,
} from "../../packages/ninebot-client/src/candidate-session.ts";
import { createFetchNinebotTransport } from "../../packages/ninebot-client/src/transport.ts";
import type { VehicleTelemetryReader } from "./vehicle-snapshot.js";

export type CandidateService = "ebike" | "motor";

export interface CandidateTelemetryClient {
  status(options: { service: CandidateService; serialNumber: string }): Promise<unknown>;
  battery(options: { service: CandidateService; serialNumber: string }): Promise<unknown>;
}

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

interface CachedVehicle {
  wnumber: string;
  business_line?: string;
}

interface CachedVehicles {
  vehicles?: CachedVehicle[];
}

interface CandidateContext {
  service: CandidateService;
  session: NinebotCandidateSessionFields;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));

const requireString = (value: unknown, label: string) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Ninebot ${label} is incomplete`);
  }
  return value;
};

const readContext = async (configDirectory: string, serialNumber: string) => {
  const [configValue, tokensValue, vehiclesValue] = await Promise.all([
    readJson(join(configDirectory, "config.json")),
    readJson(join(configDirectory, "tokens.json")),
    readJson(join(configDirectory, "vehicles.json")),
  ]);
  if (!isRecord(configValue) || !isRecord(tokensValue) || !isRecord(vehiclesValue)) {
    throw new Error("Ninebot candidate session files are invalid");
  }
  const config = configValue as Partial<CandidateConfig>;
  const tokens = tokensValue as Partial<CandidateTokens>;
  const vehicles = vehiclesValue as CachedVehicles;
  const vehicle = vehicles.vehicles?.find((item) => item.wnumber === serialNumber);
  const service = vehicle?.business_line;
  if (service !== "ebike" && service !== "motor") {
    throw new Error("Ninebot candidate vehicle service is unavailable");
  }
  const deviceId = requireString(config.device_id, "candidate device_id");
  const region = requireString(config.region, "candidate region");
  const osVersion = requireString(config.os_version, "candidate os_version");
  const osModel = requireString(config.os_model, "candidate os_model");
  const accessToken = requireString(tokens.access_token, "candidate access_token");
  const businessUid = requireString(tokens.business_uid, "candidate business_uid");
  return {
    service,
    session: {
      sys_language: "zh-hans-cn",
      client_ver: "610063322",
      device_id: deviceId,
      regionx: region,
      language: "zh",
      ostype: "and",
      lang: "zh",
      platform_ver: `${osVersion} ${osModel}`,
      platform: "android",
      login_country: "CN",
      access_token: accessToken,
      uid: businessUid,
    },
  } satisfies CandidateContext;
};

const createCandidateClient = (session: NinebotCandidateSessionFields): CandidateTelemetryClient =>
  createNinebotCandidateSessionClient({
    session,
    transport: createFetchNinebotTransport({
      origins: {
        ebike: "https://ebike.ninebot.com",
        motor: "https://steeldust.ninebot.com",
      },
    }),
    platform: 2,
  });

/** Creates an opt-in telemetry reader that falls back to ninecli on any candidate failure. */
export const createCandidateTelemetryReader = ({
  legacy,
  configDirectory,
  candidateClientFactory = createCandidateClient,
}: {
  legacy: VehicleTelemetryReader;
  configDirectory: string;
  candidateClientFactory?: (session: NinebotCandidateSessionFields) => CandidateTelemetryClient;
}): VehicleTelemetryReader => ({
  async vehicleStatus(serialNumber) {
    try {
      const context = await readContext(configDirectory, serialNumber);
      const result = await candidateClientFactory(context.session).status({
        service: context.service,
        serialNumber,
      });
      return result;
    } catch {
      return legacy.vehicleStatus(serialNumber);
    }
  },
  async battery(serialNumber) {
    try {
      const context = await readContext(configDirectory, serialNumber);
      const result = await candidateClientFactory(context.session).battery({
        service: context.service,
        serialNumber,
      });
      return result;
    } catch {
      return legacy.battery(serialNumber);
    }
  },
});
