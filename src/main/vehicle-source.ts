import type { NinebotAuthSession } from "@jiuhao/ninebot-client/node";
import type { NinebotCandidateSessionFields } from "@jiuhao/ninebot-client/candidate-session";
import {
  assertCandidateRequestActive,
  createCandidateRequestTracker,
  readCandidateSession,
  readCandidateService,
  readCandidateVehiclesIfPresent,
  type CandidateService,
  writeCandidateVehicles,
} from "./candidate-context.js";
import { createCandidateSessionClient } from "./candidate-client.js";

export type CandidateVehicleService = CandidateService;

export interface VehicleReader {
  vehicles(): Promise<unknown>;
  clear?: () => void;
}

export interface CandidateVehicleClient {
  listVehicles(options: {
    service: CandidateVehicleService;
    vehicleType: string | number;
    signal?: AbortSignal;
  }): Promise<{ data: unknown }>;
  clear?: () => void;
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

/** Minimal oracle shape kept only for migration parity tests. */
interface LegacyVehicleClient {
  vehicles(): Promise<unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const requireText = (value: unknown, label: string) => {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).length === 0) {
    throw new Error(`Ninebot ${label} is incomplete`);
  }
  return String(value);
};

/** Creates an opt-in vehicle reader; candidate service failures fall back atomically. */
export const createCandidateVehicleReader = ({
  legacy,
  configDirectory,
  sessionProvider,
  candidateClientFactory = createCandidateSessionClient,
  fallbackToLegacy = false,
}: {
  legacy?: LegacyVehicleClient;
  configDirectory: string;
  /** Supplies a fresh authenticated session before each candidate request. */
  sessionProvider?: () => Promise<NinebotAuthSession>;
  candidateClientFactory?: (session: NinebotCandidateSessionFields) => CandidateVehicleClient;
  /** Legacy oracle fallback is migration-only and must be explicitly enabled. */
  fallbackToLegacy?: boolean;
}): VehicleReader => {
  const legacyClient = legacy;
  const requireLegacy = () => {
    if (!legacyClient) throw new Error("Ninebot legacy vehicle client is not configured");
    return legacyClient;
  };
  const requestTracker = createCandidateRequestTracker();
  return {
    clear: requestTracker.clear,
    async vehicles() {
      const request = requestTracker.start();
      let candidateClient: CandidateVehicleClient | undefined;
      try {
        const sessionPromise =
          sessionProvider === undefined
            ? readCandidateSession(configDirectory)
            : sessionProvider().then((authenticatedSession) =>
                readCandidateSession(configDirectory, authenticatedSession),
              );
        const session = await sessionPromise;
        // SDK discovery always refreshes both service families. Ownerless metadata
        // is only used by the explicit legacy migration path.
        const cachedVehiclesValue = sessionProvider
          ? null
          : await readCandidateVehiclesIfPresent(configDirectory);
        if (cachedVehiclesValue !== null && !isRecord(cachedVehiclesValue)) {
          throw new Error("Ninebot candidate vehicle cache is invalid");
        }
        if (request.signal.aborted) {
          throw new Error("Ninebot candidate request was cancelled");
        }
        try {
          candidateClient = candidateClientFactory(session);
          const cachedVehicleRows = cachedVehiclesValue
            ? (cachedVehiclesValue as CachedVehicles).vehicles
            : undefined;
          const cachedRows = Array.isArray(cachedVehicleRows)
            ? cachedVehicleRows.filter((item): item is VehicleRow => isRecord(item))
            : [];
          let rows = cachedRows;
          let rowsFromDiscovery = false;
          const cachedGroups = new Map<CandidateVehicleService, VehicleRow[]>();
          for (const row of cachedRows) {
            const service = readCandidateService(row);
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
          if (!cacheHasCompleteMetadata && fallbackToLegacy) {
            const legacyValue = await requireLegacy().vehicles();
            if (Array.isArray(legacyValue)) {
              rows = legacyValue.filter((item): item is VehicleRow => isRecord(item));
            }
          }
          if (!cacheHasCompleteMetadata && !fallbackToLegacy) {
            // ninecli discovers service families with these stable wildcard model codes.
            // The response contains the concrete vehicle_type values used by travel calls.
            rows = [];
            rowsFromDiscovery = true;
            for (const [service, vehicleType] of [
              ["ebike", "65"],
              ["motor", "64"],
            ] as const) {
              if (request.signal.aborted) {
                throw new Error("Ninebot candidate request was cancelled");
              }
              // Keep discovery requests sequential to match the oracle's request cadence.
              // eslint-disable-next-line no-await-in-loop
              const result = await candidateClient.listVehicles({
                service,
                vehicleType,
                signal: request.signal,
              });
              assertCandidateRequestActive(request.signal);
              if (!Array.isArray(result.data) || !result.data.every(isRecord)) {
                throw new Error("Ninebot candidate vehicle discovery data is invalid");
              }
              rows.push(...result.data);
            }
          }
          const grouped = new Map<
            string,
            { service: CandidateVehicleService; vehicleType: string }
          >();
          for (const row of rows) {
            const service = readCandidateService(row);
            if (!service) {
              if (rowsFromDiscovery)
                throw new Error("Ninebot candidate vehicle service is invalid");
              continue;
            }
            const vehicleType = requireText(row.vehicle_type, "candidate vehicle_type");
            grouped.set(`${service}\0${vehicleType}`, { service, vehicleType });
          }
          if (grouped.size === 0 && !rowsFromDiscovery)
            throw new Error("Ninebot candidate vehicle services are unavailable");

          const candidateRows: unknown[] = [];
          const seenVehicleKeys = new Set<string>();
          const appendRows = (values: readonly unknown[]) => {
            for (const row of values) {
              if (isRecord(row)) {
                const vehicleKey = row.wnumber ?? row.sn;
                if (typeof vehicleKey === "string" && vehicleKey.length > 0) {
                  if (seenVehicleKeys.has(vehicleKey)) continue;
                  seenVehicleKeys.add(vehicleKey);
                }
              }
              candidateRows.push(row);
            }
          };
          if (rowsFromDiscovery) {
            appendRows(rows);
          }
          for (const { service, vehicleType } of rowsFromDiscovery ? [] : grouped.values()) {
            if (request.signal.aborted) {
              throw new Error("Ninebot candidate request was cancelled");
            }
            // Keep service-family requests sequential during migration to avoid bursting upstream.
            // eslint-disable-next-line no-await-in-loop
            const result = await candidateClient.listVehicles({
              service,
              vehicleType,
              signal: request.signal,
            });
            assertCandidateRequestActive(request.signal);
            if (!Array.isArray(result.data))
              throw new Error("Ninebot candidate vehicle data is invalid");
            appendRows(result.data);
          }
          // SDK persistence needs only routing fields, not display data, telemetry
          // or arbitrary fields returned by upstream. Preserve full rows for the UI.
          const cachedValue = {
            vehicles: sessionProvider
              ? candidateRows.map((row) => {
                  if (!isRecord(row)) throw new Error("Ninebot candidate vehicle data is invalid");
                  const serialNumber =
                    (typeof row.wnumber === "string" ? row.wnumber.trim() : "") ||
                    (typeof row.sn === "string" ? row.sn.trim() : "");
                  if (!serialNumber) throw new Error("Ninebot candidate vehicle id is invalid");
                  return {
                    wnumber: serialNumber,
                    business_line: readCandidateService(row),
                    vehicle_type: row.vehicle_type,
                  };
                })
              : candidateRows,
          };
          assertCandidateRequestActive(request.signal);
          await writeCandidateVehicles(
            configDirectory,
            cachedValue,
            sessionProvider ? session : undefined,
            request.signal,
          );
          assertCandidateRequestActive(request.signal);
          return candidateRows;
        } finally {
          candidateClient?.clear?.();
        }
      } catch (error) {
        if (request.signal.aborted) throw error;
        if (!fallbackToLegacy) throw error;
        return requireLegacy().vehicles();
      } finally {
        request.release();
      }
    },
  };
};
