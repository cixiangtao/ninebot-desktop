import { createNinebotAuthSessionManager } from "./auth-client.ts";
import { createNinebotNodeCryptoAdapter } from "./platform-node.ts";

import {
  createFileNinebotDeviceContextStore,
  type NinebotDeviceContext,
} from "./device-store-node.ts";

import { defaultNinebotServiceEndpoints, type NinebotServiceName } from "./service-endpoints.ts";
import { decodeGzipBody } from "./response-node.ts";
import { createFileNinebotAuthSessionStore } from "./session-store-node.ts";
import { createFetchNinebotTransport, type NinebotTransport } from "./transport.ts";

export interface CreateNinebotNodeAuthSessionManagerOptions {
  directory: string;
  /** Opt out of reading/clearing legacy tokens when running alongside the old desktop. */
  legacySession?: "compatible" | "ignore";
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
 * persists only after both stages succeed. SMS server challenges are surfaced without claiming a code was sent.
 */
export const createNinebotNodeAuthSessionManager = ({
  directory,
  legacySession = "compatible",
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
  return createNinebotAuthSessionManager({
    transport,
    crypto: {
      ...createNinebotNodeCryptoAdapter(rsaPublicKey === undefined ? {} : { rsaPublicKey }),
      ...(nonceFactory === undefined ? {} : { nonce: nonceFactory }),
    },
    deviceStore: device,
    sessionStore: createFileNinebotAuthSessionStore({
      directory,
      ...(legacySession === "ignore" ? { legacyFileName: false } : {}),
    }),
    responseBodyDecoder: decodeGzipBody,
    ...(now === undefined ? {} : { now }),
  });
};
