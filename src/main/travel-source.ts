import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createNinebotTravelCandidateClient,
  type TravelCandidateHeaderFields,
  type TravelDetailPlaintextFields,
  type TravelMonthPlaintextFields,
} from "../../packages/ninebot-client/src/travel-node.ts";
import { generateNinebotNonce } from "../../packages/ninebot-client/src/crypto-node.ts";
import { createFetchNinebotTransport } from "../../packages/ninebot-client/src/transport.ts";
import type { NineCliClient } from "./ninecli.js";

export type CandidateTravelService = "ebike" | "motor";

export interface TravelReader {
  rides(serialNumber: string, month: string): Promise<unknown>;
  rideDetail(serialNumber: string, travelId: string): Promise<unknown>;
}

export interface CandidateTravelClient {
  month(options: { fields: TravelMonthPlaintextFields; businessType: "1" | "2" }): Promise<unknown>;
  detail(options: {
    fields: TravelDetailPlaintextFields;
    businessType: "1" | "2";
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
  /** Optional model code captured from a private ninecli vehicle cache. */
  vehicle_type?: string;
}

interface CachedVehicles {
  vehicles?: CachedVehicle[];
}

interface CandidateTravelContext {
  service: CandidateTravelService;
  vehicleType: string;
  fields: Omit<TravelMonthPlaintextFields, "month" | "page" | "travel_id">;
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
    throw new Error("Ninebot candidate travel session files are invalid");
  }
  const config = configValue as Partial<CandidateConfig>;
  const tokens = tokensValue as Partial<CandidateTokens>;
  const vehicles = vehiclesValue as CachedVehicles;
  const vehicle = vehicles.vehicles?.find((item) => item.wnumber === serialNumber);
  const service = vehicle?.business_line;
  if (service !== "ebike" && service !== "motor") {
    throw new Error("Ninebot candidate travel vehicle service is unavailable");
  }
  if (!vehicle) throw new Error("Ninebot candidate travel vehicle is unavailable");
  const vehicleType = requireString(vehicle.vehicle_type, "candidate travel vehicle_type");
  const deviceId = requireString(config.device_id, "candidate device_id");
  const region = requireString(config.region, "candidate region");
  const osVersion = requireString(config.os_version, "candidate os_version");
  const osModel = requireString(config.os_model, "candidate os_model");
  const accessToken = requireString(tokens.access_token, "candidate access_token");
  const businessUid = requireString(tokens.business_uid, "candidate business_uid");
  return {
    service,
    vehicleType,
    fields: {
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
      wnumber: serialNumber,
      rnVersion: "3.0",
      vehicle_type: vehicleType,
      current_version: "610063322",
      serviceTime: Math.floor(Date.now() / 1000),
      nonce: generateNinebotNonce(),
    },
  } satisfies CandidateTravelContext;
};

const createCandidateClient = (_service: CandidateTravelService): CandidateTravelClient =>
  createNinebotTravelCandidateClient({
    transport: createFetchNinebotTransport({
      origins: { travel: "https://cn-cbu-gateway.ninebot.com" },
    }),
    platform: 2,
  });

const businessTypeFor = (service: CandidateTravelService): "1" | "2" =>
  service === "motor" ? "1" : "2";

const requestBaseFields = (context: CandidateTravelContext): TravelCandidateHeaderFields => ({
  ...context.fields,
  serviceTime: Math.floor(Date.now() / 1000),
  nonce: generateNinebotNonce(),
});

/** Creates an opt-in travel reader; each domain falls back to ninecli independently. */
export const createCandidateTravelReader = ({
  legacy,
  configDirectory,
  candidateClientFactory = createCandidateClient,
}: {
  legacy: Pick<NineCliClient, "rides" | "rideDetail">;
  configDirectory: string;
  candidateClientFactory?: (service: CandidateTravelService) => CandidateTravelClient;
}): TravelReader => ({
  async rides(serialNumber, month) {
    try {
      const context = await readContext(configDirectory, serialNumber);
      const fields = {
        ...requestBaseFields(context),
        month,
        page: "1",
        vehicle_type: context.vehicleType,
      } as TravelMonthPlaintextFields;
      return await candidateClientFactory(context.service).month({
        fields,
        businessType: businessTypeFor(context.service),
      });
    } catch {
      return legacy.rides(serialNumber, month);
    }
  },
  async rideDetail(serialNumber, travelId) {
    try {
      const context = await readContext(configDirectory, serialNumber);
      const fields = {
        ...requestBaseFields(context),
        travel_id: travelId,
        vehicle_type: context.vehicleType,
      } as TravelDetailPlaintextFields;
      return await candidateClientFactory(context.service).detail({
        fields,
        businessType: businessTypeFor(context.service),
      });
    } catch {
      return legacy.rideDetail(serialNumber, travelId);
    }
  },
});
