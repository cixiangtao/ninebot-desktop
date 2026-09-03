import type { NinebotCandidateSessionFields } from "@jiuhao/ninebot-client/candidate-session";
import {
  beginCandidateRequest,
  cancelCandidateRequests,
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

const readContext = async (configDirectory: string, serialNumber: string) => {
  const [session, vehiclesValue] = await Promise.all([
    readCandidateSession(configDirectory),
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
  candidateClientFactory = createCandidateSessionClient,
}: {
  legacy: VehicleTelemetryReader;
  configDirectory: string;
  candidateClientFactory?: (session: NinebotCandidateSessionFields) => CandidateTelemetryClient;
}): VehicleTelemetryReader => {
  const activeRequests = new Set<AbortController>();
  let generation = 0;
  return {
    clear: () => {
      generation += 1;
      cancelCandidateRequests(activeRequests);
    },
    async vehicleStatus(serialNumber) {
      const requestGeneration = generation;
      let requestController: AbortController | undefined;
      try {
        const context = await readContext(configDirectory, serialNumber);
        if (requestGeneration !== generation) {
          throw new Error("Ninebot candidate request was cancelled");
        }
        requestController = beginCandidateRequest(activeRequests);
        let candidateClient: CandidateTelemetryClient | undefined;
        try {
          candidateClient = candidateClientFactory(context.session);
          return await candidateClient.status({
            service: context.service,
            serialNumber,
            signal: requestController.signal,
          });
        } finally {
          activeRequests.delete(requestController);
          candidateClient?.clear?.();
        }
      } catch (error) {
        if (requestGeneration !== generation || requestController?.signal.aborted) throw error;
        return legacy.vehicleStatus(serialNumber);
      }
    },
    async battery(serialNumber) {
      const requestGeneration = generation;
      let requestController: AbortController | undefined;
      try {
        const context = await readContext(configDirectory, serialNumber);
        if (requestGeneration !== generation) {
          throw new Error("Ninebot candidate request was cancelled");
        }
        requestController = beginCandidateRequest(activeRequests);
        let candidateClient: CandidateTelemetryClient | undefined;
        try {
          candidateClient = candidateClientFactory(context.session);
          return await candidateClient.battery({
            service: context.service,
            serialNumber,
            signal: requestController.signal,
          });
        } finally {
          activeRequests.delete(requestController);
          candidateClient?.clear?.();
        }
      } catch (error) {
        if (requestGeneration !== generation || requestController?.signal.aborted) throw error;
        return legacy.battery(serialNumber);
      }
    },
  };
};
