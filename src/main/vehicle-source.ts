import type { NinebotCandidateSessionFields } from "@jiuhao/ninebot-client/candidate-session";
import { readCandidateSession, readCandidateVehicles } from "./candidate-context.js";
import { createCandidateSessionClient } from "./candidate-client.js";
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

/** Creates an opt-in vehicle reader; candidate service failures fall back atomically. */
export const createCandidateVehicleReader = ({
  legacy,
  configDirectory,
  candidateClientFactory = createCandidateSessionClient,
}: {
  legacy: Pick<NineCliClient, "vehicles">;
  configDirectory: string;
  candidateClientFactory?: (session: NinebotCandidateSessionFields) => CandidateVehicleClient;
}): VehicleReader => ({
  async vehicles() {
    try {
      const [session, cachedVehiclesValue] = await Promise.all([
        readCandidateSession(configDirectory),
        readCandidateVehicles(configDirectory),
      ]);
      if (!isRecord(cachedVehiclesValue))
        throw new Error("Ninebot candidate vehicle cache is invalid");
      const candidateClient = candidateClientFactory(session);
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
          serviceRows.every((row) => row.vehicle_type !== undefined),
        );
      if (!cacheHasCompleteMetadata) {
        const legacyValue = await legacy.vehicles();
        if (Array.isArray(legacyValue)) {
          rows = legacyValue.filter((item): item is VehicleRow => isRecord(item));
        }
      }
      const grouped = new Map<string, { service: CandidateVehicleService; vehicleType: string }>();
      for (const row of rows) {
        const service = readService(row);
        if (!service) continue;
        const vehicleType = requireText(row.vehicle_type, "candidate vehicle_type");
        grouped.set(`${service}\0${vehicleType}`, { service, vehicleType });
      }
      if (grouped.size === 0) throw new Error("Ninebot candidate vehicle services are unavailable");

      const candidateRows: unknown[] = [];
      const seenVehicleKeys = new Set<string>();
      for (const { service, vehicleType } of grouped.values()) {
        // Keep service-family requests sequential during migration to avoid bursting upstream.
        // eslint-disable-next-line no-await-in-loop
        const result = await candidateClient.listVehicles({
          service,
          vehicleType,
        });
        if (!Array.isArray(result.data))
          throw new Error("Ninebot candidate vehicle data is invalid");
        for (const row of result.data) {
          if (isRecord(row)) {
            const vehicleKey = row.wnumber ?? row.sn;
            if (typeof vehicleKey === "string" && vehicleKey.length > 0) {
              if (seenVehicleKeys.has(vehicleKey)) continue;
              seenVehicleKeys.add(vehicleKey);
            }
          }
          // Preserve opaque rows without identifiers; the renderer parser will discard them.
          candidateRows.push(row);
        }
      }
      return candidateRows;
    } catch {
      return legacy.vehicles();
    }
  },
});
