import {
  createFileNinebotDeviceContextStore,
  createNinebotCandidateSessionClient,
  createFetchNinebotTransport,
  createNinebotNodeAuthSessionManager,
  defaultNinebotServiceEndpoints,
  NinebotHttpError,
  NinebotBusinessSessionError,
  PassportLoginBusinessError,
  PassportLoginHttpError,
  type NinebotAuthSession,
  type NinebotAuthSessionManager,
  type NinebotCandidateService,
  type NinebotCandidateSessionClient,
  type NinebotCandidateSessionFields,
  type NinebotDeviceContext,
  type NinebotPasswordCredentials,
  type NinebotTransport,
} from "@jiuhao/ninebot-client";
import { decodeGzipBody } from "@jiuhao/ninebot-client/response-node";

type AuthClient = Pick<
  NinebotAuthSessionManager,
  "loginWithPassword" | "ensureSession" | "restore" | "refresh" | "whoami" | "logout"
>;

/** Fixed stage names keep arbitrary upstream data out of diagnostic output. */
export type AuthAcceptanceStage =
  | "login"
  | "profile"
  | "restore"
  | "refresh"
  | "restore-refreshed"
  | "profile-refreshed"
  | "vehicles"
  | "status"
  | "battery"
  | "month"
  | "detail"
  | "logout";

/** Only non-sensitive counters and fixed reason categories may enter a report. */
export interface AuthAcceptanceCheck {
  stage: AuthAcceptanceStage;
  outcome: "passed" | "failed" | "skipped";
  reason?:
    | "no-vehicle"
    | "no-trip"
    | "http"
    | "invalid-response"
    | "request-failed"
    | "cancelled"
    | "passport"
    | "business-login";
  httpStatus?: number;
  businessCode?: number;
  count?: number;
}

/** Passing covers one selected vehicle/service/month, not parity or other accounts. */
export interface AuthAcceptanceReport {
  outcome: "passed" | "failed" | "incomplete";
  service: NinebotCandidateService;
  month: string;
  checks: AuthAcceptanceCheck[];
}

/** Runtime seams allow offline verification without touching an existing account directory. */
export interface AuthAcceptanceOptions {
  /** Caller-owned isolated directory; the CLI always creates a new temporary directory. */
  directory: string;
  credentials: NinebotPasswordCredentials;
  service: NinebotCandidateService;
  month: string;
  vehicleIndex?: number;
  signal?: AbortSignal;
  createAuth?: () => AuthClient;
  loadDevice?: () => Promise<NinebotDeviceContext>;
  createClient?: (session: NinebotCandidateSessionFields) => NinebotCandidateSessionClient;
}

class InvalidAcceptanceResponse extends Error {}
function invalidResponse(): never {
  throw new InvalidAcceptanceResponse();
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const isSuccess = (code: unknown) => code === 1 || code === "1";
const requireProfile = (value: unknown) => {
  if (!isRecord(value) || Object.keys(value).length === 0) invalidResponse();
};

const createAcceptanceTransport = (signal?: AbortSignal): NinebotTransport => {
  const transport = createFetchNinebotTransport({
    origins: Object.fromEntries(
      defaultNinebotServiceEndpoints.map((endpoint) => [endpoint.service, endpoint.upstreamOrigin]),
    ),
    timeoutMs: 15_000,
  });
  return {
    send: (request) =>
      transport.send({
        ...request,
        ...(signal === undefined
          ? {}
          : { signal: request.signal ? AbortSignal.any([signal, request.signal]) : signal }),
      }),
  };
};

const sameSession = (left: NinebotAuthSession | null, right: NinebotAuthSession) =>
  left !== null &&
  (["accessToken", "refreshToken", "uuid", "expiresAtMs", "businessUid"] as const).every(
    (key) => left[key] === right[key],
  );

const failureCheck = (stage: AuthAcceptanceStage, error: unknown): AuthAcceptanceCheck => {
  if (
    (error instanceof NinebotHttpError || error instanceof PassportLoginHttpError) &&
    Number.isInteger(error.status) &&
    error.status >= 100 &&
    error.status <= 599
  ) {
    return { stage, outcome: "failed", reason: "http", httpStatus: error.status };
  }
  if (error instanceof NinebotBusinessSessionError)
    return { stage, outcome: "failed", reason: "business-login" };
  if (error instanceof PassportLoginBusinessError) {
    const code =
      typeof error.resultCode === "number" || typeof error.resultCode === "string"
        ? String(error.resultCode)
        : "";
    return {
      stage,
      outcome: "failed",
      reason: "passport",
      ...(/^\d{1,6}$/.test(code) ? { businessCode: Number(code) } : {}),
    };
  }
  return {
    stage,
    outcome: "failed",
    reason:
      error instanceof InvalidAcceptanceResponse
        ? "invalid-response"
        : error instanceof Error && error.name === "AbortError"
          ? "cancelled"
          : "request-failed",
  };
};

/**
 * Exercises fresh login, restart, explicit refresh, domain reads, and logout restoration.
 * Always clears local sessions, including on failure. Never returns tokens, identifiers,
 * upstream messages or bodies. Empty samples remain incomplete instead of passing.
 */
export const runNinebotAuthAcceptance = async ({
  directory,
  credentials,
  service,
  month,
  vehicleIndex = 0,
  signal,
  createAuth = () =>
    createNinebotNodeAuthSessionManager({
      directory,
      transport: createAcceptanceTransport(signal),
    }),
  loadDevice = () => createFileNinebotDeviceContextStore({ directory }).load(),
  createClient = (session) =>
    createNinebotCandidateSessionClient({
      session,
      platform: 2,
      transport: createAcceptanceTransport(signal),
      paginateTravelMonths: false,
      responseBodyDecoder: decodeGzipBody,
    }),
}: AuthAcceptanceOptions): Promise<AuthAcceptanceReport> => {
  const checks: AuthAcceptanceCheck[] = [];
  let stage: AuthAcceptanceStage = "login";
  let auth: AuthClient | undefined;
  const pass = (count?: number) => {
    signal?.throwIfAborted();
    checks.push({ stage, outcome: "passed", ...(count === undefined ? {} : { count }) });
  };
  const read = async <T>(operation: (client: NinebotCandidateSessionClient) => Promise<T>) => {
    if (auth === undefined) invalidResponse();
    const session = await auth.ensureSession();
    const device = await loadDevice();
    const client = createClient({
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
    });
    try {
      return await operation(client);
    } finally {
      client.clear();
    }
  };
  try {
    signal?.throwIfAborted();
    if (
      !/^\d{4}(0[1-9]|1[0-2])$/.test(month) ||
      !Number.isSafeInteger(vehicleIndex) ||
      vehicleIndex < 0
    ) {
      invalidResponse();
    }
    auth = createAuth();
    const loggedIn = await auth.loginWithPassword(credentials);
    pass();
    stage = "profile";
    requireProfile(await auth.whoami());
    pass();
    const beforeRestart = await auth.ensureSession();
    stage = "restore";
    auth = createAuth();
    if (!sameSession(await auth.restore(), beforeRestart)) invalidResponse();
    pass();
    stage = "refresh";
    const refreshed = await auth.refresh();
    if (refreshed.businessUid !== loggedIn.businessUid) invalidResponse();
    pass();
    stage = "restore-refreshed";
    auth = createAuth();
    if (!sameSession(await auth.restore(), refreshed)) invalidResponse();
    pass();
    stage = "profile-refreshed";
    requireProfile(await auth.whoami());
    pass();
    stage = "vehicles";
    const vehicles = await read((client) =>
      client.listVehicles({ service, vehicleType: service === "ebike" ? "65" : "64" }),
    );
    if (!isSuccess(vehicles.code) || !Array.isArray(vehicles.data)) invalidResponse();
    if (vehicles.data.length === 0) {
      pass(0);
      for (const skipped of ["status", "battery", "month", "detail"] as const) {
        checks.push({ stage: skipped, outcome: "skipped", reason: "no-vehicle" });
      }
    } else {
      const vehicle: unknown = vehicles.data[vehicleIndex];
      if (!isRecord(vehicle)) invalidResponse();
      const serialNumber = vehicle.wnumber ?? vehicle.sn;
      const model = vehicle.vehicle_type;
      if (
        typeof serialNumber !== "string" ||
        !serialNumber.trim() ||
        !(
          (typeof model === "string" && /^\d+$/.test(model)) ||
          (typeof model === "number" && Number.isSafeInteger(model) && model > 0)
        )
      ) {
        invalidResponse();
      }
      const vehicleType = String(model);
      pass(vehicles.data.length);
      stage = "status";
      const status = await read((client) => client.status({ service, serialNumber }));
      if (!isSuccess(status.code) || !Array.isArray(status.data) || status.data.length === 0)
        invalidResponse();
      pass(status.data.length);
      stage = "battery";
      const battery = await read((client) => client.battery({ service, serialNumber }));
      if (
        !isSuccess(battery.code) ||
        !isRecord(battery.data) ||
        Object.keys(battery.data).length === 0
      )
        invalidResponse();
      pass();
      stage = "month";
      const rides = await read((client) =>
        client.month({ service, serialNumber, vehicleType, month }),
      );
      if (
        (rides.code !== null && !isSuccess(rides.code)) ||
        rides.month !== month ||
        !Array.isArray(rides.list)
      )
        invalidResponse();
      pass(rides.list.length);
      stage = "detail";
      if (rides.list.length === 0) checks.push({ stage, outcome: "skipped", reason: "no-trip" });
      else {
        const trip = rides.list[0];
        const travelId = trip?.travel_id ?? trip?.travelId ?? trip?.id;
        if (typeof travelId !== "string" || !travelId.trim()) invalidResponse();
        const detail = await read((client) =>
          client.detail({ service, serialNumber, vehicleType, travelId }),
        );
        if (
          (detail.code !== null && !isSuccess(detail.code)) ||
          typeof detail.trail !== "string" ||
          !detail.trail.trim()
        )
          invalidResponse();
        pass();
      }
    }
  } catch (error) {
    checks.push(failureCheck(stage, error));
  } finally {
    try {
      await auth?.logout();
      if ((await createAuth().restore()) !== null) invalidResponse();
      checks.push({ stage: "logout", outcome: "passed" });
    } catch (error) {
      checks.push(failureCheck("logout", error));
    }
  }
  return {
    service,
    month,
    checks,
    outcome: checks.some((check) => check.outcome === "failed")
      ? "failed"
      : checks.some((check) => check.outcome === "skipped")
        ? "incomplete"
        : "passed",
  };
};
