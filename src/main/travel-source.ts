import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createNinebotFetchCandidateSessionClient,
  type NinebotCandidateSessionFields,
} from "@jiuhao/ninebot-client/candidate-session";
import type { NineCliClient } from "./ninecli.js";

export type CandidateTravelService = "ebike" | "motor";

export interface TravelReader {
  rides(serialNumber: string, month: string): Promise<unknown>;
  rideDetail(serialNumber: string, travelId: string): Promise<unknown>;
}

export interface CandidateTravelClient {
  month(options: {
    service: CandidateTravelService;
    serialNumber: string;
    vehicleType: string;
    month: string;
  }): Promise<unknown>;
  detail(options: {
    service: CandidateTravelService;
    serialNumber: string;
    vehicleType: string;
    travelId: string;
  }): Promise<unknown>;
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
  businessType?: string | number;
  /** Optional model code captured from a private ninecli vehicle cache. */
  vehicle_type?: string;
}

interface CachedVehicles {
  vehicles?: CachedVehicle[];
}

interface CandidateTravelContext {
  service: CandidateTravelService;
  vehicleType: string;
  session: NinebotCandidateSessionFields;
}

type LegacyTravelClient = Pick<NineCliClient, "rides" | "rideDetail"> & {
  vehicles?: () => Promise<unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));

const requireText = (value: unknown, label: string) => {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).length === 0) {
    throw new Error(`Ninebot ${label} is incomplete`);
  }
  return String(value);
};

const readService = (
  value:
    | {
        business_line?: unknown;
        businessType?: unknown;
      }
    | null
    | undefined,
): CandidateTravelService | null => {
  if (value?.business_line === "ebike" || value?.business_line === "motor") {
    return value.business_line;
  }
  if (value?.businessType === 1 || value?.businessType === "1") return "motor";
  if (value?.businessType === 2 || value?.businessType === "2") return "ebike";
  return null;
};

const readContext = async (
  configDirectory: string,
  serialNumber: string,
  loadLegacyVehicles?: () => Promise<unknown>,
) => {
  const [configValue, tokensValue, vehiclesValue] = await Promise.all([
    readJson(join(configDirectory, "config.json")),
    readJson(join(configDirectory, "tokens.json")),
    readJson(join(configDirectory, "vehicles.json")),
  ]);
  if (!isRecord(configValue) || !isRecord(tokensValue) || !isRecord(vehiclesValue)) {
    throw new Error("Ninebot candidate travel session files are invalid");
  }
  const config = configValue as Partial<CandidateConfig>;
  const tokens = tokensValue as Partial<CandidateTokens>;
  const vehicles = vehiclesValue as CachedVehicles;
  const cachedVehicle = vehicles.vehicles?.find((item) => item.wnumber === serialNumber);
  let legacyVehicle: Record<string, unknown> | null = null;
  if (!cachedVehicle?.vehicle_type && loadLegacyVehicles) {
    const legacyValue = await loadLegacyVehicles();
    const legacyRows = Array.isArray(legacyValue) ? legacyValue : [];
    legacyVehicle =
      legacyRows.find((item) => {
        if (!isRecord(item)) return false;
        return item.wnumber === serialNumber || item.sn === serialNumber;
      }) ?? null;
  }
  const vehicle = cachedVehicle ?? (legacyVehicle as CachedVehicle | null);
  const service = readService(cachedVehicle) ?? readService(legacyVehicle);
  if (!service) {
    throw new Error("Ninebot candidate travel vehicle service is unavailable");
  }
  if (!vehicle) throw new Error("Ninebot candidate travel vehicle is unavailable");
  const vehicleType = requireText(
    vehicle?.vehicle_type ?? legacyVehicle?.vehicle_type,
    "candidate travel vehicle_type",
  );
  const deviceId = requireText(config.device_id, "candidate device_id");
  const region = requireText(config.region, "candidate region");
  const osVersion = requireText(config.os_version, "candidate os_version");
  const osModel = requireText(config.os_model, "candidate os_model");
  const accessToken = requireText(tokens.access_token, "candidate access_token");
  const businessUid = requireText(tokens.business_uid, "candidate business_uid");
  return {
    service,
    vehicleType,
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
  } satisfies CandidateTravelContext;
};

const createCandidateClient = (session: NinebotCandidateSessionFields): CandidateTravelClient =>
  createNinebotFetchCandidateSessionClient({
    session,
    platform: 2,
  });

/** Creates an opt-in travel reader; each domain falls back to ninecli independently. */
export const createCandidateTravelReader = ({
  legacy,
  configDirectory,
  candidateClientFactory = createCandidateClient,
}: {
  legacy: LegacyTravelClient;
  configDirectory: string;
  candidateClientFactory?: (session: NinebotCandidateSessionFields) => CandidateTravelClient;
}): TravelReader => ({
  async rides(serialNumber, month) {
    try {
      const context = await readContext(configDirectory, serialNumber, legacy.vehicles);
      return await candidateClientFactory(context.session).month({
        service: context.service,
        serialNumber,
        vehicleType: context.vehicleType,
        month,
      });
    } catch {
      return legacy.rides(serialNumber, month);
    }
  },
  async rideDetail(serialNumber, travelId) {
    try {
      const context = await readContext(configDirectory, serialNumber, legacy.vehicles);
      return await candidateClientFactory(context.session).detail({
        service: context.service,
        serialNumber,
        vehicleType: context.vehicleType,
        travelId,
      });
    } catch {
      return legacy.rideDetail(serialNumber, travelId);
    }
  },
});
