import type { NinebotCandidateSessionFields } from "@jiuhao/ninebot-client/candidate-session";
import {
  createCandidateRequestTracker,
  readCandidateSession,
  readCandidateService,
  readCandidateVehicles,
  type CandidateService,
} from "./candidate-context.js";
import { createCandidateSessionClient } from "./candidate-client.js";
import type { NineCliClient } from "./ninecli.js";

export type CandidateTravelService = CandidateService;

export interface TravelReader {
  rides(serialNumber: string, month: string): Promise<unknown>;
  rideDetail(serialNumber: string, travelId: string): Promise<unknown>;
  clear?: () => void;
}

export interface CandidateTravelClient {
  month(options: {
    service: CandidateTravelService;
    serialNumber: string;
    vehicleType: string;
    month: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
  detail(options: {
    service: CandidateTravelService;
    serialNumber: string;
    vehicleType: string;
    travelId: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
  clear?: () => void;
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

const requireText = (value: unknown, label: string) => {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).length === 0) {
    throw new Error(`Ninebot ${label} is incomplete`);
  }
  return String(value);
};

const readContext = async (
  configDirectory: string,
  serialNumber: string,
  loadLegacyVehicles?: () => Promise<unknown>,
) => {
  const [session, vehiclesValue] = await Promise.all([
    readCandidateSession(configDirectory),
    readCandidateVehicles(configDirectory),
  ]);
  if (!isRecord(vehiclesValue)) {
    throw new Error("Ninebot candidate travel session files are invalid");
  }
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
  const service = readCandidateService(cachedVehicle) ?? readCandidateService(legacyVehicle);
  if (!service) {
    throw new Error("Ninebot candidate travel vehicle service is unavailable");
  }
  if (!vehicle) throw new Error("Ninebot candidate travel vehicle is unavailable");
  const vehicleType = requireText(
    vehicle?.vehicle_type ?? legacyVehicle?.vehicle_type,
    "candidate travel vehicle_type",
  );
  return {
    service,
    vehicleType,
    session,
  } satisfies CandidateTravelContext;
};

/** Creates an opt-in travel reader; each domain falls back to ninecli independently. */
export const createCandidateTravelReader = ({
  legacy,
  configDirectory,
  candidateClientFactory = createCandidateSessionClient,
  fallbackToLegacy = false,
}: {
  legacy: LegacyTravelClient;
  configDirectory: string;
  candidateClientFactory?: (session: NinebotCandidateSessionFields) => CandidateTravelClient;
  /** Legacy oracle fallback is migration-only and must be explicitly enabled. */
  fallbackToLegacy?: boolean;
}): TravelReader => {
  const requestTracker = createCandidateRequestTracker();
  return {
    clear: requestTracker.clear,
    async rides(serialNumber, month) {
      const request = requestTracker.start();
      let candidateClient: CandidateTravelClient | undefined;
      try {
        const context = await readContext(
          configDirectory,
          serialNumber,
          fallbackToLegacy ? legacy.vehicles : undefined,
        );
        if (request.signal.aborted) {
          throw new Error("Ninebot candidate request was cancelled");
        }
        try {
          candidateClient = candidateClientFactory(context.session);
          return await candidateClient.month({
            service: context.service,
            serialNumber,
            vehicleType: context.vehicleType,
            month,
            signal: request.signal,
          });
        } finally {
          candidateClient?.clear?.();
        }
      } catch (error) {
        if (request.signal.aborted) throw error;
        if (!fallbackToLegacy) throw error;
        return legacy.rides(serialNumber, month);
      } finally {
        request.release();
      }
    },
    async rideDetail(serialNumber, travelId) {
      const request = requestTracker.start();
      let candidateClient: CandidateTravelClient | undefined;
      try {
        const context = await readContext(
          configDirectory,
          serialNumber,
          fallbackToLegacy ? legacy.vehicles : undefined,
        );
        if (request.signal.aborted) {
          throw new Error("Ninebot candidate request was cancelled");
        }
        try {
          candidateClient = candidateClientFactory(context.session);
          return await candidateClient.detail({
            service: context.service,
            serialNumber,
            vehicleType: context.vehicleType,
            travelId,
            signal: request.signal,
          });
        } finally {
          candidateClient?.clear?.();
        }
      } catch (error) {
        if (request.signal.aborted) throw error;
        if (!fallbackToLegacy) throw error;
        return legacy.rideDetail(serialNumber, travelId);
      } finally {
        request.release();
      }
    },
  };
};
