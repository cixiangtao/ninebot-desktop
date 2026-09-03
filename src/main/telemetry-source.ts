import type { NinebotCandidateSessionFields } from "@jiuhao/ninebot-client/candidate-session";
import { readCandidateSession, readCandidateVehicles } from "./candidate-context.js";
import { createCandidateSessionClient } from "./candidate-client.js";
import type { VehicleTelemetryReader } from "./vehicle-snapshot.js";

export type CandidateService = "ebike" | "motor";

export interface CandidateTelemetryClient {
  status(options: { service: CandidateService; serialNumber: string }): Promise<unknown>;
  battery(options: { service: CandidateService; serialNumber: string }): Promise<unknown>;
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
  const service = vehicle?.business_line;
  if (service !== "ebike" && service !== "motor") {
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
