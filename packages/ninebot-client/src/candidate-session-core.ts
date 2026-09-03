import type {
  CandidateTravelBaseFields,
  CandidateTravelDetailFields,
  CandidateTravelMonthFields,
  CandidateVehicleBatteryFields,
  CandidateVehicleListFields,
  CandidateVehicleStatusFields,
  NinebotBatteryRecord,
  NinebotCandidateService,
  NinebotCandidateSessionFields,
  NinebotTelemetryResponseCandidate,
  NinebotTravelDetailResponseCandidate,
  NinebotTravelMonthResponseCandidate,
  NinebotVehicleResponseCandidate,
  NinebotStatusRecord,
} from "./candidate-contracts.ts";

export type {
  CandidateRequestFields,
  CandidateTravelBaseFields,
  CandidateTravelDetailFields,
  CandidateTravelMonthFields,
  CandidateVehicleBatteryFields,
  CandidateVehicleListFields,
  CandidateVehicleStatusFields,
  NinebotBatteryRecord,
  NinebotCandidateService,
  NinebotCandidateSessionFields,
  NinebotStatusRecord,
  NinebotTelemetryResponseCandidate,
  NinebotTravelDetailResponseCandidate,
  NinebotTravelMonthResponseCandidate,
  NinebotVehicleResponseCandidate,
} from "./candidate-contracts.ts";

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
    fields: CandidateVehicleListFields;
    headers?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<NinebotVehicleResponseCandidate>;
}

/** Minimal telemetry client contract that a runtime-specific crypto provider can implement. */
export interface CandidateTelemetrySessionClient {
  status(options: {
    service: NinebotCandidateService;
    fields: CandidateVehicleStatusFields;
    headers?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<NinebotTelemetryResponseCandidate<NinebotStatusRecord[]>>;
  battery(options: {
    service: NinebotCandidateService;
    fields: CandidateVehicleBatteryFields;
    headers?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<NinebotTelemetryResponseCandidate<NinebotBatteryRecord>>;
}

/** Minimal travel client contract that a runtime-specific crypto provider can implement. */
export interface CandidateTravelSessionClient {
  month(options: {
    fields: CandidateTravelMonthFields;
    businessType: "1" | "2";
    headers?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<NinebotTravelMonthResponseCandidate>;
  detail(options: {
    fields: CandidateTravelDetailFields;
    businessType: "1" | "2";
    headers?: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<NinebotTravelDetailResponseCandidate>;
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
  /** Fetch all monthly travel pages instead of returning only the first page. */
  paginateTravelMonths?: boolean;
}

export interface NinebotCandidateSessionClient {
  listVehicles(options: CandidateVehicleRequestOptions): Promise<NinebotVehicleResponseCandidate>;
  status(
    options: CandidateTelemetryRequestOptions,
  ): Promise<NinebotTelemetryResponseCandidate<NinebotStatusRecord[]>>;
  battery(
    options: CandidateTelemetryRequestOptions,
  ): Promise<NinebotTelemetryResponseCandidate<NinebotBatteryRecord>>;
  month(options: CandidateTravelMonthRequestOptions): Promise<NinebotTravelMonthResponseCandidate>;
  detail(
    options: CandidateTravelDetailRequestOptions,
  ): Promise<NinebotTravelDetailResponseCandidate>;
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

const assertRequestActive = (signal: AbortSignal) => {
  if (signal.aborted) {
    throw signal.reason ?? new Error("Ninebot candidate request was cancelled");
  }
};

const travelPageSize = 20;
const maxTravelPages = 100;

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
  paginateTravelMonths = true,
}: CreateNinebotCandidateSessionClientFromClientsOptions): NinebotCandidateSessionClient => {
  let sessionRef: NinebotCandidateSessionFields | null = session;
  const sessionAbortController = new AbortController();
  const withRequestId = (headers: Readonly<Record<string, string>> | undefined) => ({
    "request-id": requestIdFactory(),
    ...headers,
  });
  const getSession = () => {
    if (sessionRef === null) throw new Error("Ninebot candidate session client is closed");
    return sessionRef;
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
    const currentSession = getSession();
    const request = requestSignal(signal);
    try {
      assertRequestActive(request.signal);
      const fields: CandidateVehicleListFields = {
        ...currentSession,
        vehicle_type: asVehicleType(vehicleType),
        serviceTime: clock(),
        nonce: nonceFactory(),
      };
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
    const currentSession = getSession();
    const request = requestSignal(signal);
    try {
      assertRequestActive(request.signal);
      const fields: CandidateVehicleStatusFields = {
        ...currentSession,
        sn_str: serialNumber,
        serviceTime: clock(),
        nonce: nonceFactory(),
      };
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
    const currentSession = getSession();
    const request = requestSignal(signal);
    try {
      assertRequestActive(request.signal);
      const fields: CandidateVehicleBatteryFields = {
        ...currentSession,
        wnumber: serialNumber,
        serviceTime: clock(),
        nonce: nonceFactory(),
      };
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
    session: currentSession,
    serialNumber,
    vehicleType,
  }: {
    session: NinebotCandidateSessionFields;
    serialNumber: string;
    vehicleType: string | number;
  }): CandidateTravelBaseFields => ({
    ...currentSession,
    wnumber: serialNumber,
    rnVersion: currentSession.rnVersion ?? "743",
    vehicle_type: asVehicleType(vehicleType),
    current_version: currentSession.current_version ?? "610063322",
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
    const currentSession = getSession();
    const request = requestSignal(signal);
    try {
      assertRequestActive(request.signal);
      const fields: CandidateTravelMonthFields = {
        ...travelFields({ session: currentSession, serialNumber, vehicleType }),
        month: monthKey,
        page: "1",
      };
      const firstPage = await clients.travel.month({
        fields,
        businessType: businessTypeFor(service),
        headers: withRequestId(headers),
        signal: request.signal,
      });
      if (!paginateTravelMonths || firstPage.list.length < travelPageSize) return firstPage;

      const pages = [...firstPage.list];
      const declaredTotal = Number(firstPage.times);
      let lastPageCount = firstPage.list.length;
      for (let page = 2; page <= maxTravelPages; page += 1) {
        if (lastPageCount < travelPageSize) break;
        if (
          Number.isSafeInteger(declaredTotal) &&
          declaredTotal >= 0 &&
          pages.length >= declaredTotal
        ) {
          break;
        }
        assertRequestActive(request.signal);
        // Page N depends on whether page N-1 was full; keep requests sequential and cancellable.
        // eslint-disable-next-line no-await-in-loop
        const nextPage = await clients.travel.month({
          fields: {
            ...travelFields({ session: currentSession, serialNumber, vehicleType }),
            month: monthKey,
            page: String(page),
          },
          businessType: businessTypeFor(service),
          headers: withRequestId(headers),
          signal: request.signal,
        });
        pages.push(...nextPage.list);
        lastPageCount = nextPage.list.length;
      }
      if (
        Number.isSafeInteger(declaredTotal) &&
        declaredTotal >= 0 &&
        lastPageCount >= travelPageSize &&
        pages.length < declaredTotal
      ) {
        throw new Error(`Ninebot travel month exceeded the safe page limit (${maxTravelPages})`);
      }
      return { ...firstPage, list: pages };
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
    const currentSession = getSession();
    const request = requestSignal(signal);
    try {
      assertRequestActive(request.signal);
      const fields: CandidateTravelDetailFields = {
        ...travelFields({ session: currentSession, serialNumber, vehicleType }),
        travel_id: travelId,
      };
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
    sessionRef = null;
  };

  return { listVehicles, status, battery, month, detail, clear };
};
