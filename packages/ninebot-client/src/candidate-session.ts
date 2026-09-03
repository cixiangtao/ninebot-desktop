import { generateNinebotNonce } from "./crypto-node.ts";
import {
  buildVehicleBatteryFields,
  buildVehicleStatusFields,
  createNinebotTelemetryCandidateClient,
  type CreateNinebotTelemetryCandidateClientOptions,
  type TelemetryResponseCandidate,
  type VehicleBatteryCandidateRecord,
  type VehicleBatteryCandidateOptions,
  type VehicleStatusCandidateRecord,
  type VehicleStatusCandidateOptions,
  type TelemetryCandidateSessionFields,
} from "./telemetry-node.ts";
import {
  createNinebotTravelCandidateClient,
  type CreateNinebotTravelCandidateClientOptions,
  type TravelDetailPlaintextFields,
  type TravelDetailResponseCandidate,
  type TravelMonthPlaintextFields,
  type TravelMonthResponseCandidate,
} from "./travel-node.ts";
import {
  createNinebotVehicleCandidateClient,
  type CreateNinebotVehicleCandidateClientOptions,
  type NinebotVehicleResponseCandidate,
  type VehicleListPlaintextFields,
} from "./vehicle-node.ts";
import {
  createFetchNinebotTransport,
  type FetchNinebotTransportOptions,
  type NinebotResponse,
  type NinebotTransport,
} from "./transport.ts";
import type { NinebotServiceName } from "./protocol-lab.ts";
import type { VehicleServiceName } from "./vehicle.ts";

export type NinebotCandidateService = VehicleServiceName;

/** Shared authenticated device fields; secrets remain owned by the caller. */
export interface NinebotCandidateSessionFields extends TelemetryCandidateSessionFields {
  /** Observed React-Native track module version; defaults to the validated ninecli value. */
  rnVersion?: string;
  /** Observed app version used by travel requests; defaults to the validated client version. */
  current_version?: string;
}

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
}

export interface CandidateServiceRequestOptions {
  service: NinebotCandidateService;
  headers?: Readonly<Record<string, string>>;
}

export interface CandidateVehicleRequestOptions extends CandidateServiceRequestOptions {
  vehicleType: string | number;
}

export interface CandidateTelemetryRequestOptions extends CandidateServiceRequestOptions {
  serialNumber: string;
}

export interface CandidateTravelMonthRequestOptions extends CandidateVehicleRequestOptions {
  serialNumber: string;
  month: string;
}

export interface CandidateTravelDetailRequestOptions extends CandidateVehicleRequestOptions {
  serialNumber: string;
  travelId: string;
}

export interface NinebotCandidateSessionClient {
  listVehicles(
    options: CandidateVehicleRequestOptions,
  ): Promise<NinebotVehicleResponseCandidate<unknown>>;
  status(
    options: CandidateTelemetryRequestOptions,
  ): Promise<TelemetryResponseCandidate<VehicleStatusCandidateRecord[]>>;
  battery(
    options: CandidateTelemetryRequestOptions,
  ): Promise<TelemetryResponseCandidate<VehicleBatteryCandidateRecord>>;
  month(options: CandidateTravelMonthRequestOptions): Promise<TravelMonthResponseCandidate>;
  detail(options: CandidateTravelDetailRequestOptions): Promise<TravelDetailResponseCandidate>;
  clear(): void;
}

const businessTypeFor = (service: NinebotCandidateService): "1" | "2" =>
  service === "motor" ? "1" : "2";

const asVehicleType = (value: string | number) => {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Ninebot candidate vehicleType must be finite");
  }
  const text = String(value);
  if (text.length === 0) throw new Error("Ninebot candidate vehicleType is empty");
  return text;
};

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
 * Creates one read-only candidate client over the validated vehicle, telemetry, and travel APIs.
 *
 * The session is held only by this in-memory closure. Callers remain responsible for obtaining,
 * protecting, and clearing credentials; this helper never logs in, writes files, or exposes
 * vehicle-control operations.
 */
export const createNinebotCandidateSessionClient = ({
  session,
  clock = Date.now,
  nonceFactory = generateNinebotNonce,
  requestIdFactory = generateNinebotNonce,
  ...options
}: CreateNinebotCandidateSessionClientOptions): NinebotCandidateSessionClient => {
  let activeSession: NinebotCandidateSessionFields | null = session;
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
  const withRequestId = (headers: Readonly<Record<string, string>> | undefined) => ({
    "request-id": requestIdFactory(),
    ...headers,
  });
  const getSession = () => {
    if (activeSession === null) throw new Error("Ninebot candidate session client is closed");
    return activeSession;
  };

  const listVehicles = async ({
    service,
    vehicleType,
    headers,
  }: CandidateVehicleRequestOptions): Promise<NinebotVehicleResponseCandidate<unknown>> => {
    const fields: VehicleListPlaintextFields = {
      ...getSession(),
      vehicle_type: asVehicleType(vehicleType),
      serviceTime: clock(),
      nonce: nonceFactory(),
    };
    return vehicles.list({ service, fields, headers: withRequestId(headers) });
  };

  const status = async ({ service, serialNumber, headers }: CandidateTelemetryRequestOptions) => {
    const fields: VehicleStatusCandidateOptions["fields"] = buildVehicleStatusFields({
      session: getSession(),
      sn_str: serialNumber,
      serviceTime: clock(),
      nonce: nonceFactory(),
    });
    return telemetry.status({ service, fields, headers: withRequestId(headers) });
  };

  const battery = async ({ service, serialNumber, headers }: CandidateTelemetryRequestOptions) => {
    const fields: VehicleBatteryCandidateOptions["fields"] = buildVehicleBatteryFields({
      session: getSession(),
      wnumber: serialNumber,
      serviceTime: clock(),
      nonce: nonceFactory(),
    });
    return telemetry.battery({ service, fields, headers: withRequestId(headers) });
  };

  const travelFields = ({
    serialNumber,
    vehicleType,
  }: {
    serialNumber: string;
    vehicleType: string | number;
  }) => ({
    ...getSession(),
    wnumber: serialNumber,
    rnVersion: getSession().rnVersion ?? "743",
    vehicle_type: asVehicleType(vehicleType),
    current_version: getSession().current_version ?? "610063322",
    serviceTime: clock(),
    nonce: nonceFactory(),
  });

  const month = async ({
    service,
    serialNumber,
    vehicleType,
    month: monthKey,
    headers,
  }: CandidateTravelMonthRequestOptions) => {
    const fields = {
      ...travelFields({ serialNumber, vehicleType }),
      month: monthKey,
      page: "1",
    } as TravelMonthPlaintextFields;
    return travel.month({
      fields,
      businessType: businessTypeFor(service),
      headers: withRequestId(headers),
    });
  };

  const detail = async ({
    service,
    serialNumber,
    vehicleType,
    travelId,
    headers,
  }: CandidateTravelDetailRequestOptions) => {
    const fields = {
      ...travelFields({ serialNumber, vehicleType }),
      travel_id: travelId,
    } as TravelDetailPlaintextFields;
    return travel.detail({
      fields,
      businessType: businessTypeFor(service),
      headers: withRequestId(headers),
    });
  };

  const clear = () => {
    activeSession = null;
  };

  return { listVehicles, status, battery, month, detail, clear };
};

/** Creates the read-only candidate client with the validated Ninebot service origins. */
export const createNinebotFetchCandidateSessionClient = ({
  origins = defaultNinebotCandidateOrigins,
  fetch: fetchImpl,
  ...options
}: CreateNinebotFetchCandidateSessionClientOptions): NinebotCandidateSessionClient =>
  createNinebotCandidateSessionClient({
    ...options,
    transport: createFetchNinebotTransport({
      origins: { ...defaultNinebotCandidateOrigins, ...origins },
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
    }),
  });
