import type { NinebotAuthSession } from "@jiuhao/ninebot-client";
import type { NinebotCandidateSessionFields } from "@jiuhao/ninebot-client/candidate-session";
import {
  createCandidateRequestTracker,
  readCandidateSession,
  readCandidateService,
  readCandidateVehicles,
  type CandidateService,
} from "./candidate-context.js";
import { createCandidateSessionClient } from "./candidate-client.js";
import type { VehicleTelemetryReader } from "./vehicle-snapshot.js";

export interface CandidateTelemetryClient {
  status(options: {
    service: CandidateService;
    serialNumber: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
  battery(options: {
    service: CandidateService;
    serialNumber: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
  clear?: () => void;
}

interface CachedVehicle {
  wnumber: string;
  business_line?: string;
  businessType?: string | number;
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

const readContext = async (
  configDirectory: string,
  serialNumber: string,
  sessionProvider?: () => Promise<NinebotAuthSession>,
) => {
  const sessionPromise =
    sessionProvider === undefined
      ? readCandidateSession(configDirectory)
      : sessionProvider().then((authenticatedSession) =>
          readCandidateSession(configDirectory, authenticatedSession),
        );
  const [session, vehiclesValue] = await Promise.all([
    sessionPromise,
    readCandidateVehicles(configDirectory),
  ]);
  if (!isRecord(vehiclesValue)) {
    throw new Error("Ninebot candidate session files are invalid");
  }
  const vehicles = vehiclesValue as CachedVehicles;
  const vehicle = vehicles.vehicles?.find((item) => item.wnumber === serialNumber);
  const service = readCandidateService(vehicle);
  if (!service) {
    throw new Error("Ninebot candidate vehicle service is unavailable");
  }
  return {
    service,
    session,
  } satisfies CandidateContext;
};

/** Creates an opt-in telemetry reader that falls back to ninecli on any candidate failure. */
export const createCandidateTelemetryReader = ({
  legacy,
  configDirectory,
  sessionProvider,
  candidateClientFactory = createCandidateSessionClient,
  fallbackToLegacy = false,
}: {
  legacy?: VehicleTelemetryReader;
  configDirectory: string;
  /** Supplies a fresh authenticated session before each candidate request. */
  sessionProvider?: () => Promise<NinebotAuthSession>;
  candidateClientFactory?: (session: NinebotCandidateSessionFields) => CandidateTelemetryClient;
  /** Legacy oracle fallback is migration-only and must be explicitly enabled. */
  fallbackToLegacy?: boolean;
}): VehicleTelemetryReader => {
  const legacyClient = legacy;
  const requireLegacy = () => {
    if (!legacyClient) throw new Error("Ninebot legacy telemetry client is not configured");
    return legacyClient;
  };
  const requestTracker = createCandidateRequestTracker();
  return {
    clear: requestTracker.clear,
    async vehicleStatus(serialNumber) {
      const request = requestTracker.start();
      let candidateClient: CandidateTelemetryClient | undefined;
      try {
        const context = await readContext(configDirectory, serialNumber, sessionProvider);
        if (request.signal.aborted) {
          throw new Error("Ninebot candidate request was cancelled");
        }
        try {
          candidateClient = candidateClientFactory(context.session);
          return await candidateClient.status({
            service: context.service,
            serialNumber,
            signal: request.signal,
          });
        } finally {
          candidateClient?.clear?.();
        }
      } catch (error) {
        if (request.signal.aborted) throw error;
        if (!fallbackToLegacy) throw error;
        return requireLegacy().vehicleStatus(serialNumber);
      } finally {
        request.release();
      }
    },
    async battery(serialNumber) {
      const request = requestTracker.start();
      let candidateClient: CandidateTelemetryClient | undefined;
      try {
        const context = await readContext(configDirectory, serialNumber, sessionProvider);
        if (request.signal.aborted) {
          throw new Error("Ninebot candidate request was cancelled");
        }
        try {
          candidateClient = candidateClientFactory(context.session);
          return await candidateClient.battery({
            service: context.service,
            serialNumber,
            signal: request.signal,
          });
        } finally {
          candidateClient?.clear?.();
        }
      } catch (error) {
        if (request.signal.aborted) throw error;
        if (!fallbackToLegacy) throw error;
        return requireLegacy().battery(serialNumber);
      } finally {
        request.release();
      }
    },
  };
};
