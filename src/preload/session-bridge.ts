import { ipcChannels, type BridgeResult, type NinebotBridge } from "../shared/contracts.js";

/** Centralizes session-loss handling without exposing raw IPC or persistent credentials. */
export const createDesktopBridge = (
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
): NinebotBridge => {
  const listeners = new Set<() => void>();
  let generation = 0;
  const call = <T>(channel: string, ...args: unknown[]) =>
    invoke(channel, ...args) as Promise<BridgeResult<T>>;
  const read = async <T>(channel: string, ...args: unknown[]): Promise<BridgeResult<T>> => {
    const current = generation;
    const result = await call<T>(channel, ...args);
    if (current === generation && !result.ok && result.error.code === "AUTH_REQUIRED") {
      for (const listener of listeners) listener();
    }
    return result;
  };
  const change = <T>(channel: string, ...args: unknown[]) => {
    generation += 1;
    return call<T>(channel, ...args);
  };
  return {
    auth: {
      onSessionExpired(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      status: () => call(ipcChannels.authStatus),
      profile: () => read(ipcChannels.authProfile),
      passwordLogin: (input) => change(ipcChannels.passwordLogin, input),
      requestSmsCode: (input) => call(ipcChannels.requestSmsCode, input),
      cancelSmsCode: (input) => call(ipcChannels.cancelSmsCode, input),
      smsCodeLogin: (input) => change(ipcChannels.smsCodeLogin, input),
      logout: () => change(ipcChannels.authLogout),
    },
    runtime: { security: () => call(ipcChannels.runtimeSecurity) },
    vehicles: {
      list: () => read(ipcChannels.listVehicles),
      snapshot: (input) => read(ipcChannels.getVehicleSnapshot, input),
      location: (input) => read(ipcChannels.getVehicleLocation, input),
    },
    rides: {
      list: (input) => read(ipcChannels.listRides, input),
      detail: (input) => read(ipcChannels.getRideDetail, input),
      verifySpeeds: (input) => read(ipcChannels.verifyRideSpeeds, input),
      export: (input) => call(ipcChannels.exportRide, input),
      exportMonthSummary: (input) => call(ipcChannels.exportMonthSummary, input),
      exportYearSummary: (input) => call(ipcChannels.exportYearSummary, input),
    },
  };
};
