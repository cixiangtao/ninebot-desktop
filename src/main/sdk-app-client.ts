import type { NinebotAuthSessionManager } from "@jiuhao/ninebot-client";
import type { RuntimeSecurityStatus } from "../shared/contracts.js";
import type { NinebotAppClient } from "./app-client.js";
import type { TravelReader } from "./travel-source.js";
import type { VehicleReader } from "./vehicle-source.js";
import type { VehicleTelemetryReader } from "./vehicle-snapshot.js";

export interface NinebotSdkAppClientOptions {
  auth: NinebotAuthSessionManager;
  vehicleReader: VehicleReader;
  telemetryReader: VehicleTelemetryReader;
  travelReader: TravelReader;
  diagnostics: () => Promise<RuntimeSecurityStatus>;
}

/**
 * Composes the pure SDK session lifecycle and domain readers into the Electron
 * application client contract. No transport, filesystem, or legacy runtime is
 * created here; callers inject those boundaries explicitly.
 */
export const createNinebotSdkAppClient = ({
  auth,
  vehicleReader,
  telemetryReader,
  travelReader,
  diagnostics,
}: NinebotSdkAppClientOptions): NinebotAppClient => ({
  async login(user, areaCode, password) {
    await auth.loginWithPassword({ user, areaCode, password });
  },
  async requestSmsCode(phone, areaCode) {
    await auth.requestSmsCode({ phone, areaCode });
  },
  async loginWithSmsCode(phone, areaCode, code) {
    await auth.loginWithSmsCode({ phone, areaCode, code });
  },
  async logout() {
    await auth.logout();
  },
  async whoami() {
    return auth.whoami();
  },
  diagnostics,
  vehicles: () => vehicleReader.vehicles(),
  vehicleStatus: (serialNumber) => telemetryReader.vehicleStatus(serialNumber),
  battery: (serialNumber) => telemetryReader.battery(serialNumber),
  rides: (serialNumber, month) => travelReader.rides(serialNumber, month),
  rideDetail: (serialNumber, travelId) => travelReader.rideDetail(serialNumber, travelId),
  clear() {
    vehicleReader.clear?.();
    telemetryReader.clear?.();
    travelReader.clear?.();
  },
});
