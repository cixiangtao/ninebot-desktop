import { generateNinebotNonce } from "./crypto-node.ts";
import {
  createNinebotCandidateSessionClientFromClients,
  type NinebotCandidateSessionClient,
  type NinebotCandidateSessionFields,
} from "./candidate-session-core.ts";
import {
  createNinebotTelemetryCandidateClient,
  type CreateNinebotTelemetryCandidateClientOptions,
} from "./telemetry-node.ts";
import {
  createNinebotTravelCandidateClient,
  type CreateNinebotTravelCandidateClientOptions,
} from "./travel-node.ts";
import {
  createNinebotVehicleCandidateClient,
  type CreateNinebotVehicleCandidateClientOptions,
} from "./vehicle-node.ts";
import {
  createFetchNinebotTransport,
  type FetchNinebotTransportOptions,
  type NinebotResponse,
  type NinebotTransport,
} from "./transport.ts";
import type { NinebotServiceName } from "./protocol-lab.ts";

export type {
  CandidateServiceRequestOptions,
  CandidateTelemetryRequestOptions,
  CandidateTravelDetailRequestOptions,
  CandidateTravelMonthRequestOptions,
  CandidateVehicleRequestOptions,
  NinebotCandidateService,
  NinebotCandidateSessionClient,
  NinebotCandidateSessionFields,
} from "./candidate-session-core.ts";

interface CandidateProtocolOptions {
  transport: NinebotTransport;
  platform: number;
  p?: string;
  t?: string;
  timeStamp?: number;
  rsaPublicKey?: Uint8Array | string;
  responseBodyDecoder?: (response: NinebotResponse) => Uint8Array | Promise<Uint8Array>;
}

export interface CreateNinebotCandidateSessionClientOptions extends CandidateProtocolOptions {
  session: NinebotCandidateSessionFields;
  /** Clock used for per-request serviceTime values; defaults to Date.now. */
  clock?: () => number;
  /** Nonce source used for per-request request/body values; defaults to the secure generator. */
  nonceFactory?: () => string;
  /** Request-id source used for transport headers; defaults to the secure generator. */
  requestIdFactory?: () => string;
  /** Fetch all monthly travel pages instead of returning only the first page. */
  paginateTravelMonths?: boolean;
}

export const defaultNinebotCandidateOrigins = {
  ebike: "https://ebike.ninebot.com",
  motor: "https://steeldust.ninebot.com",
  travel: "https://cn-cbu-gateway.ninebot.com",
} as const satisfies Readonly<Partial<Record<NinebotServiceName, string>>>;

export interface CreateNinebotFetchCandidateSessionClientOptions extends Omit<
  CreateNinebotCandidateSessionClientOptions,
  "transport"
> {
  /** Optional origin overrides for self-hosted gateways or protocol test environments. */
  origins?: FetchNinebotTransportOptions["origins"];
  /** Optional fetch implementation for tests, proxies, or alternate Node runtimes. */
  fetch?: typeof globalThis.fetch;
  /** Optional upper bound for one fetch call, in milliseconds. */
  timeoutMs?: FetchNinebotTransportOptions["timeoutMs"];
}

const protocolOptions = ({
  transport,
  platform,
  p,
  t,
  timeStamp,
  rsaPublicKey,
  responseBodyDecoder,
}: CandidateProtocolOptions) => ({
  transport,
  platform,
  ...(p === undefined ? {} : { p }),
  ...(t === undefined ? {} : { t }),
  ...(timeStamp === undefined ? {} : { timeStamp }),
  ...(rsaPublicKey === undefined ? {} : { rsaPublicKey }),
  ...(responseBodyDecoder === undefined ? {} : { responseBodyDecoder }),
});

/**
 * Creates the Node-backed candidate session client used by Electron.
 *
 * The lifecycle and field orchestration lives in the platform-neutral core; this adapter only
 * supplies the Node crypto-backed service clients and keeps the existing synchronous API.
 */
export const createNinebotCandidateSessionClient = ({
  session,
  clock = Date.now,
  nonceFactory = generateNinebotNonce,
  requestIdFactory = generateNinebotNonce,
  paginateTravelMonths = true,
  ...options
}: CreateNinebotCandidateSessionClientOptions): NinebotCandidateSessionClient => {
  const sharedOptions = protocolOptions(options);
  const telemetry = createNinebotTelemetryCandidateClient(
    sharedOptions as CreateNinebotTelemetryCandidateClientOptions,
  );
  const travel = createNinebotTravelCandidateClient(
    sharedOptions as CreateNinebotTravelCandidateClientOptions,
  );
  const vehicles = createNinebotVehicleCandidateClient(
    sharedOptions as CreateNinebotVehicleCandidateClientOptions,
  );
  return createNinebotCandidateSessionClientFromClients({
    session,
    clients: { telemetry, travel, vehicles },
    clock,
    nonceFactory,
    requestIdFactory,
    paginateTravelMonths,
  });
};

/** Creates the read-only candidate client with the validated Ninebot service origins. */
export const createNinebotFetchCandidateSessionClient = ({
  origins = defaultNinebotCandidateOrigins,
  fetch: fetchImpl,
  timeoutMs,
  ...options
}: CreateNinebotFetchCandidateSessionClientOptions): NinebotCandidateSessionClient =>
  createNinebotCandidateSessionClient({
    ...options,
    transport: createFetchNinebotTransport({
      origins: { ...defaultNinebotCandidateOrigins, ...origins },
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }),
  });
