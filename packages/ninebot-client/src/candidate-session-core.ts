import type {
  TelemetryResponseCandidate,
  VehicleBatteryCandidateRecord,
  VehicleBatteryCandidateOptions,
  VehicleStatusCandidateRecord,
  VehicleStatusCandidateOptions,
} from "./telemetry-node.ts";
import type {
  TravelDetailPlaintextFields,
  TravelDetailResponseCandidate,
  TravelMonthPlaintextFields,
  TravelMonthResponseCandidate,
} from "./travel-node.ts";
import type {
  NinebotVehicleResponseCandidate,
  VehicleListPlaintextFields,
} from "./vehicle-node.ts";
import type { VehicleServiceName } from "./vehicle.ts";

/** Supported candidate service families. */
export type NinebotCandidateService = VehicleServiceName;

/** Shared authenticated device fields required by every candidate request. */
export interface NinebotCandidateSessionFields {
  sys_language: string;
  client_ver: string;
  device_id: string;
  regionx: string;
  language: string;
  ostype: string;
  lang: string;
  platform_ver: string;
  platform: string;
  login_country: string;
  access_token: string;
  uid: string;
  /** Observed React-Native track module version used by travel requests. */
  rnVersion?: string;
  /** Observed app version used by travel requests. */
  current_version?: string;
}

export interface CandidateServiceRequestOptions {
  service: NinebotCandidateService;
  headers?: Readonly<Record<string, string>>;
  /** Optional caller-owned cancellation signal for this read-only request. */
  signal?: AbortSignal;
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

/** Minimal vehicle client contract that a runtime-specific crypto provider can implement. */
export interface CandidateVehicleSessionClient {
  list(options: {
    service: NinebotCandidateService;
    fields: VehicleListPlaintextFields;
    headers?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<NinebotVehicleResponseCandidate<unknown>>;
}

/** Minimal telemetry client contract that a runtime-specific crypto provider can implement. */
export interface CandidateTelemetrySessionClient {
  status(options: {
    service: NinebotCandidateService;
    fields: VehicleStatusCandidateOptions["fields"];
    headers?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<TelemetryResponseCandidate<VehicleStatusCandidateRecord[]>>;
  battery(options: {
    service: NinebotCandidateService;
    fields: VehicleBatteryCandidateOptions["fields"];
    headers?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<TelemetryResponseCandidate<VehicleBatteryCandidateRecord>>;
}

/** Minimal travel client contract that a runtime-specific crypto provider can implement. */
export interface CandidateTravelSessionClient {
  month(options: {
    fields: TravelMonthPlaintextFields;
    businessType: "1" | "2";
    headers?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<TravelMonthResponseCandidate>;
  detail(options: {
    fields: TravelDetailPlaintextFields;
    businessType: "1" | "2";
    headers?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<TravelDetailResponseCandidate>;
}

/** Runtime-specific implementations used by the platform-neutral session orchestrator. */
export interface NinebotCandidateSessionClients {
  vehicles: CandidateVehicleSessionClient;
  telemetry: CandidateTelemetrySessionClient;
  travel: CandidateTravelSessionClient;
}

export interface CreateNinebotCandidateSessionClientFromClientsOptions {
  session: NinebotCandidateSessionFields;
  clients: NinebotCandidateSessionClients;
  /** Clock used for per-request serviceTime values; defaults to Date.now. */
  clock?: () => number;
  /** Secure nonce source. Hosts without Web Crypto should inject their platform source. */
  nonceFactory?: () => string;
  /** Request-id source used for transport headers; defaults to the nonce source. */
  requestIdFactory?: () => string;
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
  /** Cancels in-flight operations and releases the session reference. */
  clear(): void;
}

const generateWebNonce = () => {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw new Error("Ninebot candidate nonceFactory is required when Web Crypto is unavailable");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
};

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

interface RequestSignal {
  signal: AbortSignal;
  cleanup: () => void;
}

const mergeAbortSignals = (signals: readonly AbortSignal[]): RequestSignal => {
  const nativeAny = (
    AbortSignal as typeof AbortSignal & {
      any?: (signals: readonly AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof nativeAny === "function") return { signal: nativeAny(signals), cleanup: () => {} };

  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  const cleanup = () => {
    for (const [signal, listener] of listeners) signal.removeEventListener("abort", listener);
    listeners.clear();
  };
  const abort = (signal: AbortSignal) => {
    cleanup();
    controller.abort(signal.reason);
  };
  for (const signal of signals) {
    if (signal.aborted) {
      abort(signal);
      return { signal: controller.signal, cleanup };
    }
    const listener = () => abort(signal);
    listeners.set(signal, listener);
    signal.addEventListener("abort", listener, { once: true });
  }
  controller.signal.addEventListener("abort", cleanup, { once: true });
  return { signal: controller.signal, cleanup };
};

/**
 * Composes runtime-specific candidate clients behind one platform-neutral session API.
 *
 * The function performs field assembly, request-id propagation and lifecycle cancellation,
 * but never imports or assumes a crypto implementation. Browser, React Native and Electron
 * hosts can therefore share the orchestration while providing their own encrypted clients.
 */
export const createNinebotCandidateSessionClientFromClients = ({
  session,
  clients,
  clock = Date.now,
  nonceFactory = generateWebNonce,
  requestIdFactory = nonceFactory,
}: CreateNinebotCandidateSessionClientFromClientsOptions): NinebotCandidateSessionClient => {
  let activeSession: NinebotCandidateSessionFields | null = session;
  const sessionAbortController = new AbortController();
  const withRequestId = (headers: Readonly<Record<string, string>> | undefined) => ({
    "request-id": requestIdFactory(),
    ...headers,
  });
  const getSession = () => {
    if (activeSession === null) throw new Error("Ninebot candidate session client is closed");
    return activeSession;
  };
  const requestSignal = (callerSignal: AbortSignal | undefined) =>
    callerSignal === undefined
      ? { signal: sessionAbortController.signal, cleanup: () => {} }
      : mergeAbortSignals([sessionAbortController.signal, callerSignal]);

  const listVehicles = async ({
    service,
    vehicleType,
    headers,
    signal,
  }: CandidateVehicleRequestOptions) => {
    const fields: VehicleListPlaintextFields = {
      ...getSession(),
      vehicle_type: asVehicleType(vehicleType),
      serviceTime: clock(),
      nonce: nonceFactory(),
    };
    const request = requestSignal(signal);
    try {
      return await clients.vehicles.list({
        service,
        fields,
        headers: withRequestId(headers),
        signal: request.signal,
      });
    } finally {
      request.cleanup();
    }
  };

  const status = async ({
    service,
    serialNumber,
    headers,
    signal,
  }: CandidateTelemetryRequestOptions) => {
    const fields = {
      ...getSession(),
      sn_str: serialNumber,
      serviceTime: clock(),
      nonce: nonceFactory(),
    };
    const request = requestSignal(signal);
    try {
      return await clients.telemetry.status({
        service,
        fields,
        headers: withRequestId(headers),
        signal: request.signal,
      });
    } finally {
      request.cleanup();
    }
  };

  const battery = async ({
    service,
    serialNumber,
    headers,
    signal,
  }: CandidateTelemetryRequestOptions) => {
    const fields = {
      ...getSession(),
      wnumber: serialNumber,
      serviceTime: clock(),
      nonce: nonceFactory(),
    };
    const request = requestSignal(signal);
    try {
      return await clients.telemetry.battery({
        service,
        fields,
        headers: withRequestId(headers),
        signal: request.signal,
      });
    } finally {
      request.cleanup();
    }
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
    signal,
  }: CandidateTravelMonthRequestOptions) => {
    const fields = {
      ...travelFields({ serialNumber, vehicleType }),
      month: monthKey,
      page: "1",
    } as TravelMonthPlaintextFields;
    const request = requestSignal(signal);
    try {
      return await clients.travel.month({
        fields,
        businessType: businessTypeFor(service),
        headers: withRequestId(headers),
        signal: request.signal,
      });
    } finally {
      request.cleanup();
    }
  };

  const detail = async ({
    service,
    serialNumber,
    vehicleType,
    travelId,
    headers,
    signal,
  }: CandidateTravelDetailRequestOptions) => {
    const fields = {
      ...travelFields({ serialNumber, vehicleType }),
      travel_id: travelId,
    } as TravelDetailPlaintextFields;
    const request = requestSignal(signal);
    try {
      return await clients.travel.detail({
        fields,
        businessType: businessTypeFor(service),
        headers: withRequestId(headers),
        signal: request.signal,
      });
    } finally {
      request.cleanup();
    }
  };

  const clear = () => {
    sessionAbortController.abort(new Error("Ninebot candidate session client was cleared"));
    activeSession = null;
  };

  return { listVehicles, status, battery, month, detail, clear };
};
