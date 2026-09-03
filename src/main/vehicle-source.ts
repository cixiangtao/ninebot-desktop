import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createNinebotCandidateSessionClient,
  type NinebotCandidateSessionFields,
} from "../../packages/ninebot-client/src/candidate-session.ts";
import { createFetchNinebotTransport } from "../../packages/ninebot-client/src/transport.ts";
import type { NineCliClient } from "./ninecli.js";

export type CandidateVehicleService = "ebike" | "motor";

export interface VehicleReader {
  vehicles(): Promise<unknown>;
}

export interface CandidateVehicleClient {
  listVehicles(options: {
    service: CandidateVehicleService;
    vehicleType: string | number;
  }): Promise<{ data: unknown }>;
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

interface VehicleRow {
  wnumber?: unknown;
  businessType?: unknown;
  business_line?: unknown;
  vehicle_type?: unknown;
}

interface CachedVehicles {
  vehicles?: VehicleRow[];
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

const readService = (row: VehicleRow): CandidateVehicleService | null => {
  if (row.business_line === "ebike" || row.business_line === "motor") return row.business_line;
  if (row.businessType === 1 || row.businessType === "1") return "motor";
  if (row.businessType === 2 || row.businessType === "2") return "ebike";
  return null;
};

const createCandidateClient = (session: NinebotCandidateSessionFields): CandidateVehicleClient =>
  createNinebotCandidateSessionClient({
    session,
    transport: createFetchNinebotTransport({
      origins: {
        ebike: "https://ebike.ninebot.com",
        motor: "https://steeldust.ninebot.com",
        travel: "https://cn-cbu-gateway.ninebot.com",
      },
    }),
    platform: 2,
  });

const buildSession = (
  config: Partial<CandidateConfig>,
  tokens: Partial<CandidateTokens>,
): NinebotCandidateSessionFields => ({
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
});

/** Creates an opt-in vehicle reader; candidate service failures fall back atomically. */
export const createCandidateVehicleReader = ({
  legacy,
  configDirectory,
  candidateClientFactory = createCandidateClient,
}: {
  legacy: Pick<NineCliClient, "vehicles">;
  configDirectory: string;
  candidateClientFactory?: (session: NinebotCandidateSessionFields) => CandidateVehicleClient;
}): VehicleReader => ({
  async vehicles() {
    try {
      const [configValue, tokensValue, cachedVehiclesValue] = await Promise.all([
        readJson(join(configDirectory, "config.json")),
        readJson(join(configDirectory, "tokens.json")),
        readJson(join(configDirectory, "vehicles.json")),
      ]);
      if (!isRecord(configValue) || !isRecord(tokensValue) || !isRecord(cachedVehiclesValue)) {
        throw new Error("Ninebot candidate vehicle session is invalid");
      }
      const session = buildSession(
        configValue as Partial<CandidateConfig>,
        tokensValue as Partial<CandidateTokens>,
      );
      const cachedVehicleRows = (cachedVehiclesValue as CachedVehicles).vehicles;
      const cachedRows = Array.isArray(cachedVehicleRows)
        ? cachedVehicleRows.filter((item): item is VehicleRow => isRecord(item))
        : [];
      let rows = cachedRows;
      const cachedGroups = new Map<CandidateVehicleService, VehicleRow[]>();
      for (const row of cachedRows) {
        const service = readService(row);
        if (!service) continue;
        const serviceRows = cachedGroups.get(service) ?? [];
        serviceRows.push(row);
        cachedGroups.set(service, serviceRows);
      }
      const cacheHasCompleteMetadata =
        cachedGroups.size > 0 &&
        [...cachedGroups.values()].every((serviceRows) =>
          serviceRows.some((row) => row.vehicle_type !== undefined),
        );
      if (!cacheHasCompleteMetadata) {
        const legacyValue = await legacy.vehicles();
        if (Array.isArray(legacyValue)) {
          rows = legacyValue.filter((item): item is VehicleRow => isRecord(item));
        }
      }
      const grouped = new Map<CandidateVehicleService, VehicleRow[]>();
      for (const row of rows) {
        const service = readService(row);
        if (!service) continue;
        const serviceRows = grouped.get(service) ?? [];
        serviceRows.push(row);
        grouped.set(service, serviceRows);
      }
      if (grouped.size === 0) throw new Error("Ninebot candidate vehicle services are unavailable");

      const candidateRows: unknown[] = [];
      for (const [service, serviceRows] of grouped) {
        const vehicleType = serviceRows.find((row) => row.vehicle_type !== undefined)?.vehicle_type;
        // Keep service-family requests sequential during migration to avoid bursting upstream.
        // eslint-disable-next-line no-await-in-loop
        const result = await candidateClientFactory(session).listVehicles({
          service,
          vehicleType: requireText(vehicleType, "candidate vehicle_type"),
        });
        if (!Array.isArray(result.data))
          throw new Error("Ninebot candidate vehicle data is invalid");
        candidateRows.push(...result.data);
      }
      return candidateRows;
    } catch {
      return legacy.vehicles();
    }
  },
});
