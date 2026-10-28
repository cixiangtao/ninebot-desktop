import {
  createNinebotAuthSessionManager,
  type CreateNinebotAuthSessionManagerOptions,
} from "./auth-client.ts";
import type { NinebotAuthSession } from "./auth.ts";
import type { NinebotDeviceContext } from "./device-context.ts";
import {
  createNinebotCandidateSessionClientFromClients,
  type NinebotCandidateSessionClient,
  type NinebotCandidateSessionFields,
  type CandidateVehicleRequestOptions,
  type CandidateTravelMonthRequestOptions,
  type CandidateTravelDetailRequestOptions,
  type CandidateTelemetryRequestOptions,
} from "./candidate-session-core.ts";
import { createNinebotServiceClients } from "./services.ts";

/** Maps complete authentication into the observed wire context, without files or global state. */
export const createNinebotSessionFields = (
  session: NinebotAuthSession,
  device: NinebotDeviceContext,
): NinebotCandidateSessionFields => ({
  sys_language: "zh-hans-cn",
  client_ver: "610063322",
  device_id: device.deviceId,
  regionx: device.region,
  language: "zh",
  ostype: "and",
  lang: "zh",
  platform_ver: `${device.osVersion} ${device.osModel}`,
  platform: "android",
  login_country: "CN",
  access_token: session.accessToken,
  uid: session.businessUid,
  ...(session.uuid === undefined ? {} : { uuid: session.uuid }),
  ...(session.refreshToken === undefined ? {} : { refresh_token: session.refreshToken }),
});

export interface CreateNinebotSdkOptions extends CreateNinebotAuthSessionManagerOptions {
  /** Defaults to full-month pagination with completeness checks. */
  paginateTravelMonths?: boolean;
}

/**
 * Public SDK facade. Construction is offline. Auth changes cancel pending business reads;
 * each operation obtains a fresh complete session and never caches account data globally.
 */
export const createNinebotSdk = (options: CreateNinebotSdkOptions) => {
  const manager = createNinebotAuthSessionManager(options);
  const clients = createNinebotServiceClients(options);
  const active = new Set<NinebotCandidateSessionClient>();
  let generation = 0;
  const invalidate = () => {
    generation += 1;
    for (const client of active) client.clear();
    active.clear();
  };
  const assertGeneration = (expected: number) => {
    if (generation !== expected) throw new Error("Ninebot session changed during request");
  };
  const read = async <T>(operation: (client: NinebotCandidateSessionClient) => Promise<T>) => {
    const expected = generation;
    const session = await manager.ensureSession();
    assertGeneration(expected);
    const device = await options.deviceStore.load();
    assertGeneration(expected);
    const client = createNinebotCandidateSessionClientFromClients({
      session: createNinebotSessionFields(session, device),
      clients,
      nonceFactory: () => options.crypto.nonce(),
      ...(options.now === undefined ? {} : { clock: options.now }),
      ...(options.paginateTravelMonths === undefined
        ? {}
        : { paginateTravelMonths: options.paginateTravelMonths }),
    });
    active.add(client);
    try {
      const result = await operation(client);
      assertGeneration(expected);
      return result;
    } finally {
      active.delete(client);
      client.clear();
    }
  };
  return {
    auth: {
      restore: () => {
        invalidate();
        return manager.restore();
      },
      loginWithPassword: (...args: Parameters<typeof manager.loginWithPassword>) => {
        invalidate();
        return manager.loginWithPassword(...args);
      },
      requestSmsCode: (...args: Parameters<typeof manager.requestSmsCode>) =>
        manager.requestSmsCode(...args),
      loginWithSmsCode: (...args: Parameters<typeof manager.loginWithSmsCode>) => {
        invalidate();
        return manager.loginWithSmsCode(...args);
      },
      logout: () => {
        invalidate();
        return manager.logout();
      },
      refresh: () => {
        invalidate();
        return manager.refresh();
      },
      whoami: <T = unknown>() => manager.whoami<T>(),
      getSession: () => manager.getSession(),
      getRefreshEligibility: () => manager.getRefreshEligibility(),
      observeDiagnostics: (...args: Parameters<typeof manager.observeDiagnostics>) =>
        manager.observeDiagnostics(...args),
    },
    vehicles: {
      list: (request: CandidateVehicleRequestOptions) =>
        read((client) => client.listVehicles(request)),
    },
    travels: {
      list: (request: CandidateTravelMonthRequestOptions) =>
        read((client) => client.month(request)),
      get: (request: CandidateTravelDetailRequestOptions) =>
        read((client) => client.detail(request)),
    },
    telemetry: {
      status: (request: CandidateTelemetryRequestOptions) =>
        read((client) => client.status(request)),
      battery: (request: CandidateTelemetryRequestOptions) =>
        read((client) => client.battery(request)),
    },
  };
};

export type NinebotSdk = ReturnType<typeof createNinebotSdk>;
