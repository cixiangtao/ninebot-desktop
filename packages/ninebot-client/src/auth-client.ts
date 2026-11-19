import { NinebotAuthSessionManager, type NinebotAuthSessionStore } from "./auth.ts";
import { createNinebotBusinessSessionInitializerCore } from "./business-session-core.ts";
import type { NinebotDeviceContextStore } from "./device-context.ts";
import { createNinebotPassportLoginClient } from "./passport-login-client.ts";
import { createNinebotPassportAuthProvider } from "./passport-auth-provider.ts";
import { createNinebotServiceClients, type NinebotServiceClientsOptions } from "./services.ts";

export interface CreateNinebotAuthSessionManagerOptions extends NinebotServiceClientsOptions {
  sessionStore: NinebotAuthSessionStore;
  deviceStore: Pick<NinebotDeviceContextStore, "load">;
  now?: () => number;
}

/** Portable two-stage login and refresh, with host-owned transport, crypto and storage. */
export const createNinebotAuthSessionManager = (
  options: CreateNinebotAuthSessionManagerOptions,
) => {
  const passport = createNinebotPassportLoginClient({
    transport: options.transport,
    ...options.crypto.passport,
    smsRegion: async () => (await options.deviceStore.load()).region,
    ...(options.responseBodyDecoder === undefined
      ? {}
      : { responseBodyDecoder: options.responseBodyDecoder }),
  });
  return new NinebotAuthSessionManager({
    store: options.sessionStore,
    provider: createNinebotPassportAuthProvider(passport, {
      initializeBusinessSession: createNinebotBusinessSessionInitializerCore({
        client: createNinebotServiceClients(options).business,
        deviceContext: () => options.deviceStore.load(),
        nonceFactory: () => options.crypto.nonce(),
        ...(options.now === undefined ? {} : { now: options.now }),
      }),
    }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
};
