import { NinebotHttpError } from "./client.ts";
import { computeNinebotBodyCheckcode, generateNinebotNonce } from "./crypto-node.ts";
import {
  buildNinebotEncryptedRequestCandidate,
  decryptNinebotResponsePayloadCandidate,
  generateNinebotCandidateRequestMaterial,
} from "./crypto-codec.ts";
import type { NinebotCandidateKeyData } from "./crypto-codec.ts";
import {
  parseNinebotEncryptedResponse,
  serializeNinebotEncryptedRequest,
  type NinebotEncryptedRequestEnvelope,
  type NinebotEncryptedResponseEnvelope,
} from "./crypto-envelope.ts";
import { ninebotCandidateRsaPublicKeyPem } from "./rsa-node.ts";
import type { NinebotResponse, NinebotTransport } from "./transport.ts";

export const vehicleStatusPath = "/vehicle/vehicle/desktop-component" as const;
export const vehicleBatteryPath = "/v6/vehicle/battery-info" as const;

/** Shared device/session fields sent to status and battery endpoints. */
export interface TelemetryCandidateHeaderFields {
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
  /** Milliseconds since Unix epoch, as required by status/battery endpoints. */
  serviceTime: number;
  nonce: string;
}

export interface VehicleStatusPlaintextFields extends TelemetryCandidateHeaderFields {
  sn_str: string;
}

export interface VehicleBatteryPlaintextFields extends TelemetryCandidateHeaderFields {
  wnumber: string;
}

/** Session/device fields shared by both telemetry requests before per-request values are added. */
export type TelemetryCandidateSessionFields = Omit<
  TelemetryCandidateHeaderFields,
  "serviceTime" | "nonce"
>;

export interface BuildVehicleStatusFieldsOptions {
  session: TelemetryCandidateSessionFields;
  sn_str: string;
  serviceTime?: number;
  nonce?: string;
}

export interface BuildVehicleBatteryFieldsOptions {
  session: TelemetryCandidateSessionFields;
  wnumber: string;
  serviceTime?: number;
  nonce?: string;
}

const telemetryBaseKeys = [
  "sys_language",
  "client_ver",
  "device_id",
  "regionx",
  "language",
  "ostype",
  "lang",
  "platform_ver",
  "platform",
  "login_country",
  "access_token",
  "uid",
] as const satisfies readonly (keyof TelemetryCandidateHeaderFields)[];

const assertTelemetryBaseFields = (fields: TelemetryCandidateHeaderFields) => {
  for (const key of telemetryBaseKeys) {
    const value = fields[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Ninebot telemetry request field ${key} is invalid`);
    }
  }
  if (!Number.isSafeInteger(fields.serviceTime)) {
    throw new Error("Ninebot telemetry request field serviceTime must be a safe integer");
  }
  if (!/^[0-9A-Fa-f]{32}$/.test(fields.nonce)) {
    throw new Error("Ninebot telemetry request field nonce must be 32 hexadecimal characters");
  }
};

const buildTelemetryHeaderFields = ({
  session,
  serviceTime = Date.now(),
  nonce = generateNinebotNonce(),
}: {
  session: TelemetryCandidateSessionFields;
  serviceTime?: number;
  nonce?: string;
}): TelemetryCandidateHeaderFields => ({ ...session, serviceTime, nonce });

const buildTelemetryBody = <T extends TelemetryCandidateHeaderFields>(
  fields: T,
  keys: readonly (keyof T)[],
  label: string,
) => {
  assertTelemetryBaseFields(fields);
  for (const key of keys) {
    const value = fields[key];
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error(`Ninebot ${label} request field ${String(key)} is invalid`);
    }
    if (typeof value === "string" && value.length === 0) {
      throw new Error(`Ninebot ${label} request field ${String(key)} is empty`);
    }
  }
  const unsignedFields = Object.fromEntries(keys.map((key) => [key, fields[key]]));
  const unsignedBody = JSON.stringify(unsignedFields);
  return new TextEncoder().encode(
    JSON.stringify({ ...unsignedFields, checkcode: computeNinebotBodyCheckcode(unsignedBody) }),
  );
};

const statusKeys = [...telemetryBaseKeys, "sn_str", "serviceTime", "nonce"] as const;
const batteryKeys = [...telemetryBaseKeys, "wnumber", "serviceTime", "nonce"] as const;

/** Builds the observed status request body and uppercase MD5 checkcode. */
export const buildVehicleStatusPlaintextBody = (fields: VehicleStatusPlaintextFields) =>
  buildTelemetryBody(fields, statusKeys, "status");

/** Builds the observed battery request body and uppercase MD5 checkcode. */
export const buildVehicleBatteryPlaintextBody = (fields: VehicleBatteryPlaintextFields) =>
  buildTelemetryBody(fields, batteryKeys, "battery");

/** Builds validated status fields with a millisecond `serviceTime`. */
export const buildVehicleStatusFields = ({
  session,
  sn_str,
  serviceTime,
  nonce,
}: BuildVehicleStatusFieldsOptions): VehicleStatusPlaintextFields => ({
  ...buildTelemetryHeaderFields({
    session,
    ...(serviceTime === undefined ? {} : { serviceTime }),
    ...(nonce === undefined ? {} : { nonce }),
  }),
  sn_str,
});

/** Builds validated battery fields with a millisecond `serviceTime`. */
export const buildVehicleBatteryFields = ({
  session,
  wnumber,
  serviceTime,
  nonce,
}: BuildVehicleBatteryFieldsOptions): VehicleBatteryPlaintextFields => ({
  ...buildTelemetryHeaderFields({
    session,
    ...(serviceTime === undefined ? {} : { serviceTime }),
    ...(nonce === undefined ? {} : { nonce }),
  }),
  wnumber,
});

export interface BuildTelemetryEncryptedRequestCandidateOptions {
  plaintextBody: Uint8Array;
  platform: number;
  p?: string;
  t?: string;
  timeStamp?: number;
  /** Defaults to the public key embedded in ninecli 0.1.7. */
  rsaPublicKey?: Uint8Array | string;
}

const buildTelemetryEncryptedRequestCandidate = ({
  plaintextBody,
  platform,
  p = "101",
  t = "0",
  timeStamp,
  rsaPublicKey,
}: BuildTelemetryEncryptedRequestCandidateOptions) => {
  const material = generateNinebotCandidateRequestMaterial(
    timeStamp === undefined ? { platform, p, t } : { platform, p, t, timeStamp },
  );
  return {
    envelope: buildNinebotEncryptedRequestCandidate({
      plaintextBody,
      material,
      rsaPublicKey: rsaPublicKey ?? ninebotCandidateRsaPublicKeyPem,
    }),
    keyData: material.keyData,
  };
};

export interface VehicleTelemetryEncryptedRequestCandidate {
  envelope: NinebotEncryptedRequestEnvelope;
  keyData: NinebotCandidateKeyData;
}

/** Builds a status request candidate and returns its response key context. */
export const buildVehicleStatusEncryptedRequestCandidate = ({
  fields,
  ...options
}: BuildTelemetryEncryptedRequestCandidateOptions & { fields: VehicleStatusPlaintextFields }) =>
  buildTelemetryEncryptedRequestCandidate({
    ...options,
    plaintextBody: buildVehicleStatusPlaintextBody(fields),
  });

/** Builds a battery request candidate and returns its response key context. */
export const buildVehicleBatteryEncryptedRequestCandidate = ({
  fields,
  ...options
}: BuildTelemetryEncryptedRequestCandidateOptions & { fields: VehicleBatteryPlaintextFields }) =>
  buildTelemetryEncryptedRequestCandidate({
    ...options,
    plaintextBody: buildVehicleBatteryPlaintextBody(fields),
  });

export interface TelemetryResponseCandidate<TData = unknown, TExtra = unknown> {
  code: number | string | null;
  data: TData;
  desc: string | null;
  time_cost: number | string | null;
  extra: TExtra;
}

export type NinebotTelemetryDataKind =
  | "array"
  | "boolean"
  | "null"
  | "number"
  | "object"
  | "string"
  | "undefined";

const getTelemetryDataKind = (value: unknown): NinebotTelemetryDataKind => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const kind = typeof value;
  if (
    kind === "boolean" ||
    kind === "number" ||
    kind === "object" ||
    kind === "string" ||
    kind === "undefined"
  ) {
    return kind;
  }
  return "undefined";
};

/** Business-level telemetry failure without retaining the response body. */
export class NinebotTelemetryBusinessError extends Error {
  readonly code: number | string | null;
  readonly desc: string | null;
  readonly dataKind: NinebotTelemetryDataKind;

  constructor(message: string, response: TelemetryResponseCandidate<unknown>) {
    super(message);
    this.name = "NinebotTelemetryBusinessError";
    this.code = response.code;
    this.desc = response.desc;
    this.dataKind = getTelemetryDataKind(response.data);
  }
}

export interface VehicleStatusLocationCandidate {
  acc?: number | string | boolean;
  lat?: number | string;
  lock?: number | string | boolean;
  lon?: number | string;
  [key: string]: unknown;
}

/** Known status fields, with an open index for firmware-specific additions. */
export interface VehicleStatusCandidateRecord {
  ai_estimate_mileage?: number | string;
  battery_exist?: number | string | boolean;
  charging?: number | string | boolean;
  dump_energy?: number | string;
  estimate_mileage?: number | string;
  is_smart_service_expired?: number | string | boolean;
  loc?: VehicleStatusLocationCandidate;
  permissions?: Record<string, unknown>;
  precise_estimate_mileage?: number | string;
  pwr?: number | string | boolean;
  remain_charge_time?: string;
  remain_charge_timestamp?: number | string;
  sn?: string;
  [key: string]: unknown;
}

export interface VehicleBatteryPackCandidate {
  bat_temp?: number | string;
  bms_cycle?: number | string;
  bms_cycle_support?: boolean;
  bms_cycle_tips?: string;
  bms_volt?: number | string;
  electricity?: number | string;
  score?: number | string;
  [key: string]: unknown;
}

/** Known battery fields, with an open index for firmware-specific additions. */
export interface VehicleBatteryCandidateRecord {
  battery_count?: number | string;
  battery_find_my_support?: boolean;
  battery_list?: VehicleBatteryPackCandidate[];
  battery_main?: { electricity?: number | string; [key: string]: unknown };
  battery_type?: number | string;
  charging?: number | string | boolean;
  electricity?: number | string;
  have_bms_cycle_support?: boolean;
  remain_charge_time?: string;
  [key: string]: unknown;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readScalar = (record: Record<string, unknown>, key: string) => {
  const value = record[key];
  if (value === null || typeof value === "string" || typeof value === "number")
    return value ?? null;
  throw new Error(`Ninebot telemetry response field ${key} is invalid`);
};

/** Parses the shared business wrapper returned by status and battery endpoints. */
export const parseTelemetryResponseCandidate = <TData = unknown, TExtra = unknown>(
  plaintext: Uint8Array,
): TelemetryResponseCandidate<TData, TExtra> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Ninebot telemetry response payload is not valid JSON");
  }
  const record = asRecord(parsed);
  if (!record || !("data" in record)) {
    throw new Error("Ninebot telemetry response payload is not a business wrapper");
  }
  if (record.desc !== undefined && record.desc !== null && typeof record.desc !== "string") {
    throw new Error("Ninebot telemetry response field desc is invalid");
  }
  return {
    code: readScalar(record, "code"),
    data: record.data as TData,
    desc: typeof record.desc === "string" ? record.desc : null,
    time_cost: readScalar(record, "time_cost"),
    extra: (record.extra ?? null) as TExtra,
  };
};

/** Parses status data as the one-or-more vehicle records returned by ninecli. */
export const parseVehicleStatusResponseCandidate = (
  plaintext: Uint8Array,
): TelemetryResponseCandidate<VehicleStatusCandidateRecord[]> => {
  const response = parseTelemetryResponseCandidate<unknown>(plaintext);
  if (!Array.isArray(response.data)) {
    throw new NinebotTelemetryBusinessError(
      "Ninebot status response data is not an array; business request may have failed",
      response,
    );
  }
  const data = response.data.map((item, index) => {
    const record = asRecord(item);
    if (!record) throw new Error(`Ninebot status response data item ${index} is not an object`);
    return record as VehicleStatusCandidateRecord;
  });
  return { ...response, data };
};

/** Parses battery data as the diagnostic object returned by ninecli. */
export const parseVehicleBatteryResponseCandidate = (
  plaintext: Uint8Array,
): TelemetryResponseCandidate<VehicleBatteryCandidateRecord> => {
  const response = parseTelemetryResponseCandidate<unknown>(plaintext);
  const data = asRecord(response.data);
  if (!data) {
    throw new NinebotTelemetryBusinessError(
      "Ninebot battery response data is not an object; business request may have failed",
      response,
    );
  }
  return { ...response, data: data as VehicleBatteryCandidateRecord };
};

/** Decrypts and parses a status response with its per-request key context. */
export const decodeVehicleStatusResponseCandidate = ({
  envelope,
  keyData,
}: {
  envelope: NinebotEncryptedResponseEnvelope;
  keyData: NinebotCandidateKeyData;
}) =>
  parseVehicleStatusResponseCandidate(
    decryptNinebotResponsePayloadCandidate({ envelope, keyData }),
  );

/** Decrypts and parses a battery response with its per-request key context. */
export const decodeVehicleBatteryResponseCandidate = ({
  envelope,
  keyData,
}: {
  envelope: NinebotEncryptedResponseEnvelope;
  keyData: NinebotCandidateKeyData;
}) =>
  parseVehicleBatteryResponseCandidate(
    decryptNinebotResponsePayloadCandidate({ envelope, keyData }),
  );

/** Decrypts one telemetry response while retaining its business wrapper metadata. */
export const decodeTelemetryResponseCandidate = ({
  envelope,
  keyData,
}: {
  envelope: NinebotEncryptedResponseEnvelope;
  keyData: NinebotCandidateKeyData;
}) =>
  parseTelemetryResponseCandidate(decryptNinebotResponsePayloadCandidate({ envelope, keyData }));

export interface CreateNinebotTelemetryCandidateClientOptions {
  transport: NinebotTransport;
  platform: number;
  p?: string;
  t?: string;
  timeStamp?: number;
  /** Defaults to the public key embedded in ninecli 0.1.7. */
  rsaPublicKey?: Uint8Array | string;
  responseBodyDecoder?: (response: NinebotResponse) => Uint8Array | Promise<Uint8Array>;
}

interface VehicleTelemetryCandidateOptionsBase {
  service: "ebike" | "motor";
  headers?: Readonly<Record<string, string>>;
}

export interface VehicleStatusCandidateOptions extends VehicleTelemetryCandidateOptionsBase {
  fields: VehicleStatusPlaintextFields;
}

export interface VehicleBatteryCandidateOptions extends VehicleTelemetryCandidateOptionsBase {
  fields: VehicleBatteryPlaintextFields;
}

/** Creates a transport-backed Node client for status and battery candidates. */
export const createNinebotTelemetryCandidateClient = ({
  transport,
  platform,
  p = "101",
  t = "0",
  timeStamp,
  rsaPublicKey,
  responseBodyDecoder = (response) => response.body,
}: CreateNinebotTelemetryCandidateClientOptions) => {
  const send = async <TData>(
    service: "ebike" | "motor",
    path: typeof vehicleStatusPath | typeof vehicleBatteryPath,
    fields: TelemetryCandidateHeaderFields,
    plaintextBody: Uint8Array,
    headers: Readonly<Record<string, string>> | undefined,
    decode: (plaintext: Uint8Array) => TelemetryResponseCandidate<TData>,
  ): Promise<TelemetryResponseCandidate<TData>> => {
    const material = generateNinebotCandidateRequestMaterial(
      timeStamp === undefined ? { platform, p, t } : { platform, p, t, timeStamp },
    );
    const envelope = buildNinebotEncryptedRequestCandidate({
      plaintextBody,
      material,
      rsaPublicKey: rsaPublicKey ?? ninebotCandidateRsaPublicKeyPem,
    });
    const response = await transport.send({
      service,
      method: "POST",
      path,
      headers: {
        ...buildTelemetryCandidateHeaders({ service, fields }),
        ...headers,
      },
      body: new TextEncoder().encode(serializeNinebotEncryptedRequest(envelope)),
    });
    if (response.status < 200 || response.status >= 300)
      throw new NinebotHttpError(response.status);
    const responseBody = await responseBodyDecoder(response);
    return decode(
      decryptNinebotResponsePayloadCandidate({
        envelope: parseNinebotEncryptedResponse(responseBody),
        keyData: material.keyData,
      }),
    );
  };
  return {
    status: (options: VehicleStatusCandidateOptions) =>
      send<VehicleStatusCandidateRecord[]>(
        options.service,
        vehicleStatusPath,
        options.fields,
        buildVehicleStatusPlaintextBody(options.fields),
        options.headers,
        parseVehicleStatusResponseCandidate,
      ),
    battery: (options: VehicleBatteryCandidateOptions) =>
      send<VehicleBatteryCandidateRecord>(
        options.service,
        vehicleBatteryPath,
        options.fields,
        buildVehicleBatteryPlaintextBody(options.fields),
        options.headers,
        parseVehicleBatteryResponseCandidate,
      ),
  };
};

export interface BuildTelemetryCandidateHeadersOptions {
  service: "ebike" | "motor";
  fields: TelemetryCandidateHeaderFields;
  requestId?: string;
  serviceTime?: number;
}

/** Builds the observed status/battery request headers. */
export const buildTelemetryCandidateHeaders = ({
  service,
  fields,
  requestId = generateNinebotNonce(),
  serviceTime = fields.serviceTime,
}: BuildTelemetryCandidateHeadersOptions) => {
  if (!/^[0-9A-Fa-f]{32}$/.test(requestId)) {
    throw new Error(
      "Ninebot telemetry request header request-id must be 32 hexadecimal characters",
    );
  }
  if (!Number.isSafeInteger(serviceTime)) {
    throw new Error("Ninebot telemetry request header service-time must be a safe integer");
  }
  const platformVersion = fields.platform_ver.split(" ")[0];
  if (!platformVersion) throw new Error("Ninebot telemetry request header platform-ver is empty");
  return {
    "accept-encoding": "gzip",
    "business-type": service === "motor" ? "1" : "2",
    "cache-control": "no-cache",
    "client-ver": fields.client_ver,
    "content-type": "text/html;charset=UTF-8",
    debug: "0",
    "device-id": fields.device_id,
    language: fields.language,
    "login-country": fields.login_country,
    need_decrypt: "1",
    "ninebot-version": "2",
    platform: fields.platform.toLowerCase() === "android" ? "Android" : fields.platform,
    "platform-ver": platformVersion,
    regionx: fields.regionx,
    "request-id": requestId,
    "service-time": String(serviceTime),
    "sys-language": fields.sys_language,
    uid: fields.uid,
    "user-agent": "okhttp/4.9.1",
  };
};
