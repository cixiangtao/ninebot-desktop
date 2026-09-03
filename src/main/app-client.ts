import type { RuntimeSecurityStatus } from "../shared/contracts.js";
import type { TravelReader } from "./travel-source.js";
import type { VehicleReader } from "./vehicle-source.js";
import type { VehicleTelemetryReader } from "./vehicle-snapshot.js";

/** Stable error categories exposed by any application data client. */
export type NinebotClientErrorKind =
  | "missing"
  | "auth"
  | "verification"
  | "integrity"
  | "unsupported"
  | "upstream";

/** Error contract shared by the legacy oracle and the SDK-backed client. */
export class NinebotClientError extends Error {
  constructor(
    message: string,
    readonly kind: NinebotClientErrorKind = "upstream",
  ) {
    super(message);
    this.name = "NinebotClientError";
  }
}

/**
 * Renderer-facing application client contract.
 *
 * Electron IPC depends on this capability surface instead of a concrete
 * runtime. The current ninecli adapter and the future pure SDK adapter can
 * therefore be swapped without changing renderer handlers.
 */
export interface NinebotAppClient extends VehicleTelemetryReader, TravelReader, VehicleReader {
  login(user: string, areaCode: string, password: string): Promise<void>;
  requestSmsCode(phone: string, areaCode: string): Promise<void>;
  loginWithSmsCode(phone: string, areaCode: string, code: string): Promise<void>;
  logout(): Promise<void>;
  whoami(): Promise<unknown>;
  diagnostics(): Promise<RuntimeSecurityStatus>;
}
