import { computeNinebotBodyCheckcode } from "./protocol-checksum.ts";
import type { VehicleServiceName } from "./vehicle.ts";
/** Protocol values observed for both vehicle-list service families. */
export const ninebotVehicleCandidateProtocol = { p: "101", t: "0" } as const;

/** Fields observed in the plaintext JSON sent before vehicle-list encryption. */
export interface VehicleListPlaintextFields {
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
  vehicle_type: string;
  serviceTime: number;
  nonce: string;
}

const vehicleListPlaintextKeys = [
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
  "vehicle_type",
  "serviceTime",
  "nonce",
] as const satisfies readonly (keyof VehicleListPlaintextFields)[];

const assertVehicleListPlaintextFields = (fields: VehicleListPlaintextFields) => {
  for (const key of vehicleListPlaintextKeys) {
    const value = fields[key];
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error(`Ninebot vehicle request field ${key} is invalid`);
    }
    if (typeof value === "string" && value.length === 0) {
      throw new Error(`Ninebot vehicle request field ${key} is empty`);
    }
  }
  if (!Number.isSafeInteger(fields.serviceTime)) {
    throw new Error("Ninebot vehicle request field serviceTime must be a safe integer");
  }
  if (!/^[0-9A-Fa-f]{32}$/.test(fields.nonce)) {
    throw new Error("Ninebot vehicle request field nonce must be 32 hexadecimal characters");
  }
};

/** Builds the ordered vehicle-list JSON and its uppercase MD5 `checkcode`. */
export const buildVehicleListPlaintextBody = (fields: VehicleListPlaintextFields): Uint8Array => {
  assertVehicleListPlaintextFields(fields);
  const unsignedFields = Object.fromEntries(
    vehicleListPlaintextKeys.map((key) => [key, fields[key]]),
  ) as unknown as VehicleListPlaintextFields;
  const unsignedBody = JSON.stringify(unsignedFields);
  const body = { ...unsignedFields, checkcode: computeNinebotBodyCheckcode(unsignedBody) };
  return new TextEncoder().encode(JSON.stringify(body));
};

export interface BuildVehicleListCandidateHeadersOptions {
  service: VehicleServiceName;
  fields: VehicleListPlaintextFields;
  requestId: string;
  serviceTime?: number;
}

/** Builds the observed request headers for a vehicle-list request. */
export const buildVehicleListCandidateHeaders = ({
  service,
  fields,
  requestId,
  serviceTime = fields.serviceTime,
}: BuildVehicleListCandidateHeadersOptions) => {
  if (!/^[0-9A-Fa-f]{32}$/.test(requestId)) {
    throw new Error("Ninebot vehicle request header request-id must be 32 hexadecimal characters");
  }
  if (!Number.isSafeInteger(serviceTime)) {
    throw new Error("Ninebot vehicle request header service-time must be a safe integer");
  }
  const platformHeader = fields.platform.toLowerCase() === "android" ? "Android" : fields.platform;
  const platformVersion = fields.platform_ver.split(" ")[0];
  if (!platformVersion) throw new Error("Ninebot vehicle request header platform-ver is empty");
  return {
    "business-type": service === "motor" ? "1" : "2",
    "cache-control": "no-cache",
    "client-ver": fields.client_ver,
    "device-id": fields.device_id,
    debug: "0",
    access_token: fields.access_token,
    language: fields.language,
    "login-country": fields.login_country,
    platform: platformHeader,
    "platform-ver": platformVersion,
    regionx: fields.regionx,
    "request-id": requestId,
    "service-time": String(serviceTime),
    "sys-language": fields.sys_language,
    uid: fields.uid,
    "user-agent": "okhttp/4.9.1",
  };
};

export interface NinebotVehicleResponseCandidate<T = unknown> {
  code: number | string | null;
  data: T;
  desc: string | null;
  time_cost: number | null;
  extra: unknown;
}

/** Parses the business JSON produced after vehicle-list response decryption. */
export const parseVehicleListResponseCandidate = <T = unknown>(
  plaintext: Uint8Array,
): NinebotVehicleResponseCandidate<T> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Ninebot vehicle response payload is not valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Ninebot vehicle response payload is not a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const code = record.code;
  if (code !== null && code !== undefined && typeof code !== "number" && typeof code !== "string") {
    throw new Error("Ninebot vehicle response field code is invalid");
  }
  const desc = record.desc;
  if (desc !== null && desc !== undefined && typeof desc !== "string") {
    throw new Error("Ninebot vehicle response field desc is invalid");
  }
  const timeCost = record.time_cost;
  if (timeCost !== null && timeCost !== undefined && typeof timeCost !== "number") {
    throw new Error("Ninebot vehicle response field time_cost is invalid");
  }
  if (!("data" in record)) throw new Error("Ninebot vehicle response field data is missing");
  return {
    code: code === undefined ? null : code,
    data: record.data as T,
    desc: desc === undefined ? null : desc,
    time_cost: timeCost === undefined ? null : timeCost,
    extra: record.extra ?? null,
  };
};
