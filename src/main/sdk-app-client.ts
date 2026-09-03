import {
  PassportLoginBusinessError,
  PassportLoginHttpError,
  type NinebotAuthSessionManager,
} from "@jiuhao/ninebot-client";
import type { RuntimeSecurityStatus } from "../shared/contracts.js";
import { NinebotClientError, type NinebotAppClient } from "./app-client.js";
import type { TravelReader } from "./travel-source.js";
import type { VehicleReader } from "./vehicle-source.js";
import type { VehicleTelemetryReader } from "./vehicle-snapshot.js";

const passportAuthCodes = new Set(["90016", "90017", "90018", "90019", "00002", "00003"]);

/** Converts Passport transport failures to the renderer's stable client error contract. */
export const normalizeSdkAuthError = (error: unknown): unknown => {
  if (error instanceof PassportLoginBusinessError) {
    const kind = passportAuthCodes.has(String(error.resultCode)) ? "auth" : "upstream";
    return new NinebotClientError(error.message, kind);
  }
  if (error instanceof PassportLoginHttpError) {
    return new NinebotClientError("九号认证服务暂时不可用，请稍后重试。", "upstream");
  }
  return error;
};

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
    try {
      await auth.loginWithPassword({ user, areaCode, password });
    } catch (error) {
      throw normalizeSdkAuthError(error);
    }
  },
  async requestSmsCode(phone, areaCode) {
    try {
      await auth.requestSmsCode({ phone, areaCode });
    } catch (error) {
      throw normalizeSdkAuthError(error);
    }
  },
  async loginWithSmsCode(phone, areaCode, code) {
    try {
      await auth.loginWithSmsCode({ phone, areaCode, code });
    } catch (error) {
      throw normalizeSdkAuthError(error);
    }
  },
  async logout() {
    try {
      await auth.logout();
    } catch (error) {
      throw normalizeSdkAuthError(error);
    }
  },
  async whoami() {
    try {
      return await auth.whoami();
    } catch (error) {
      throw normalizeSdkAuthError(error);
    }
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
