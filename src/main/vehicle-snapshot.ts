import type { VehicleSnapshot } from "../shared/contracts.js";
import { NineCliError } from "./ninecli.js";
import { parseVehicleSnapshot } from "./parsers.js";

interface VehicleTelemetryReader {
  vehicleStatus: (serialNumber: string) => Promise<unknown>;
  battery: (serialNumber: string) => Promise<unknown>;
}

const isDegradableFailure = (reason: unknown) =>
  reason instanceof NineCliError && reason.kind === "upstream";

/** Reads independent vehicle domains and preserves whichever upstream service succeeds. */
export const loadVehicleSnapshot = async (
  client: VehicleTelemetryReader,
  serialNumber: string,
): Promise<VehicleSnapshot> => {
  const [statusResult, batteryResult] = await Promise.allSettled([
    client.vehicleStatus(serialNumber),
    client.battery(serialNumber),
  ]);
  const rejectedResults = [statusResult, batteryResult].filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  const fatalFailure = rejectedResults.find(({ reason }) => !isDegradableFailure(reason));
  if (fatalFailure) throw fatalFailure.reason;
  if (rejectedResults.length === 2) throw rejectedResults[0]?.reason;

  return parseVehicleSnapshot(
    statusResult.status === "fulfilled" ? statusResult.value : null,
    batteryResult.status === "fulfilled" ? batteryResult.value : null,
    {
      status: statusResult.status === "fulfilled",
      battery: batteryResult.status === "fulfilled",
    },
  );
};
