import { NinebotAuthSessionManager } from "./auth.ts";
import { createNinebotBusinessSessionInitializer } from "./business-session-node.ts";
import {
  createFileNinebotDeviceContextStore,
  type NinebotDeviceContext,
} from "./device-store-node.ts";
import { createNinebotPassportAuthProvider } from "./passport-auth-provider.ts";
import { createNinebotPassportLoginClient } from "./passport-login-client.ts";
import { defaultNinebotServiceEndpoints, type NinebotServiceName } from "./protocol-lab.ts";
import { decodeGzipBody } from "./response-node.ts";
import { createFileNinebotAuthSessionStore } from "./session-store-node.ts";
import { createFetchNinebotTransport, type NinebotTransport } from "./transport.ts";

export interface CreateNinebotNodeAuthSessionManagerOptions {
  directory: string;
  /** Injected transport takes precedence over fetch/origin/timeout options. */
  transport?: NinebotTransport;
  origins?: Readonly<Partial<Record<NinebotServiceName, string>>>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** Defaults affect new device contexts only; existing metadata is preserved. */
  deviceDefaults?: Partial<Omit<NinebotDeviceContext, "deviceId">>;
  now?: () => number;
  nonceFactory?: () => string;
  rsaPublicKey?: Uint8Array | string;
}

/**
 * Composes Node password authentication, encrypted business bootstrap and file storage.
 * Construction makes no requests; restore reads local complete sessions, while login
 * persists only after both stages succeed. SMS challenges remain explicitly unsupported.
 */
export const createNinebotNodeAuthSessionManager = ({
  directory,
  transport: suppliedTransport,
  origins,
  fetch,
  timeoutMs = 15_000,
  deviceDefaults,
  now,
  nonceFactory,
  rsaPublicKey,
}: CreateNinebotNodeAuthSessionManagerOptions) => {
  const transport =
    suppliedTransport ??
    createFetchNinebotTransport({
      origins: {
        ...Object.fromEntries(
          defaultNinebotServiceEndpoints.map((endpoint) => [
            endpoint.service,
            endpoint.upstreamOrigin,
          ]),
        ),
        ...origins,
      },
      ...(fetch === undefined ? {} : { fetch }),
      timeoutMs,
    });
  const device = createFileNinebotDeviceContextStore({
    directory,
    ...(deviceDefaults === undefined ? {} : { defaults: deviceDefaults }),
  });
  const initializeBusinessSession = createNinebotBusinessSessionInitializer({
    transport,
    deviceContext: () => device.load(),
    ...(now === undefined ? {} : { now }),
    ...(nonceFactory === undefined ? {} : { nonceFactory }),
    ...(rsaPublicKey === undefined ? {} : { rsaPublicKey }),
  });
  const passport = createNinebotPassportLoginClient({
    transport,
    responseBodyDecoder: decodeGzipBody,
  });
  return new NinebotAuthSessionManager({
    provider: createNinebotPassportAuthProvider(passport, { initializeBusinessSession }),
    store: createFileNinebotAuthSessionStore({ directory }),
    ...(now === undefined ? {} : { now }),
  });
};
