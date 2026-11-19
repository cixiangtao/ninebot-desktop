import { computeNinebotBodyCheckcode } from "./protocol-checksum.ts";
export const travelMonthPath = "/app-api/travel/v6/travel-list2" as const;
export const travelDetailPath = "/app-api/travel/v6/travel-info" as const;

/** Shared device/session fields sent to both travel endpoints. */
export interface TravelCandidateHeaderFields {
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
  rnVersion: string;
  current_version: string;
  serviceTime: number;
  nonce: string;
}

/** Fields observed in the plaintext sent to the monthly travel endpoint. */
export interface TravelMonthPlaintextFields extends TravelCandidateHeaderFields {
  wnumber: string;
  vehicle_type: string;
  month: string;
  page: string;
}

const travelMonthPlaintextKeys = [
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
  "wnumber",
  "rnVersion",
  "vehicle_type",
  "month",
  "page",
  "current_version",
  "serviceTime",
  "nonce",
] as const satisfies readonly (keyof TravelMonthPlaintextFields)[];

const assertTravelMonthPlaintextFields = (fields: TravelMonthPlaintextFields) => {
  for (const key of travelMonthPlaintextKeys) {
    const value = fields[key];
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error(`Ninebot travel request field ${key} is invalid`);
    }
    if (typeof value === "string" && value.length === 0) {
      throw new Error(`Ninebot travel request field ${key} is empty`);
    }
  }
  if (!/^\d{6}$/.test(fields.month)) {
    throw new Error("Ninebot travel request field month must be YYYYMM");
  }
  const monthNumber = Number(fields.month.slice(4));
  if (monthNumber < 1 || monthNumber > 12) {
    throw new Error("Ninebot travel request field month is out of range");
  }
  if (!Number.isSafeInteger(fields.serviceTime)) {
    throw new Error("Ninebot travel request field serviceTime must be a safe integer");
  }
  if (!/^[0-9A-Fa-f]{32}$/.test(fields.nonce)) {
    throw new Error("Ninebot travel request field nonce must be 32 hexadecimal characters");
  }
};

/** Builds the observed ordered monthly travel JSON and uppercase MD5 checkcode. */
export const buildTravelMonthPlaintextBody = (fields: TravelMonthPlaintextFields): Uint8Array => {
  assertTravelMonthPlaintextFields(fields);
  const unsignedFields = Object.fromEntries(
    travelMonthPlaintextKeys.map((key) => [key, fields[key]]),
  ) as unknown as TravelMonthPlaintextFields;
  const unsignedBody = JSON.stringify(unsignedFields);
  const body = { ...unsignedFields, checkcode: computeNinebotBodyCheckcode(unsignedBody) };
  return new TextEncoder().encode(JSON.stringify(body));
};

/** Fields observed in the plaintext sent to the single-ride travel endpoint. */
export interface TravelDetailPlaintextFields extends TravelCandidateHeaderFields {
  wnumber: string;
  vehicle_type: string;
  travel_id: string;
}

const travelDetailPlaintextKeys = [
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
  "wnumber",
  "rnVersion",
  "vehicle_type",
  "travel_id",
  "current_version",
  "serviceTime",
  "nonce",
] as const satisfies readonly (keyof TravelDetailPlaintextFields)[];

const assertTravelDetailPlaintextFields = (fields: TravelDetailPlaintextFields) => {
  for (const key of travelDetailPlaintextKeys) {
    const value = fields[key];
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error(`Ninebot travel detail request field ${key} is invalid`);
    }
    if (typeof value === "string" && value.length === 0) {
      throw new Error(`Ninebot travel detail request field ${key} is empty`);
    }
  }
  if (!Number.isSafeInteger(fields.serviceTime)) {
    throw new Error("Ninebot travel detail request field serviceTime must be a safe integer");
  }
  if (!/^[0-9A-Fa-f]{32}$/.test(fields.nonce)) {
    throw new Error("Ninebot travel detail request field nonce must be 32 hexadecimal characters");
  }
};

/** Builds the observed ordered single-ride JSON and uppercase MD5 checkcode. */
export const buildTravelDetailPlaintextBody = (fields: TravelDetailPlaintextFields): Uint8Array => {
  assertTravelDetailPlaintextFields(fields);
  const unsignedFields = Object.fromEntries(
    travelDetailPlaintextKeys.map((key) => [key, fields[key]]),
  ) as unknown as TravelDetailPlaintextFields;
  const unsignedBody = JSON.stringify(unsignedFields);
  const body = { ...unsignedFields, checkcode: computeNinebotBodyCheckcode(unsignedBody) };
  return new TextEncoder().encode(JSON.stringify(body));
};

export interface BuildTravelCandidateHeadersOptions {
  fields: TravelCandidateHeaderFields;
  /** Ninebot business line: `1` for motor and `2` for ebike. */
  businessType: "1" | "2";
  requestId: string;
  serviceTime?: number;
}

/** Builds the observed request headers for the travel service. */
export const buildTravelCandidateHeaders = ({
  fields,
  businessType,
  requestId,
  serviceTime = fields.serviceTime,
}: BuildTravelCandidateHeadersOptions) => {
  if (!/^[0-9A-Fa-f]{32}$/.test(requestId)) {
    throw new Error("Ninebot travel request header request-id must be 32 hexadecimal characters");
  }
  if (!Number.isSafeInteger(serviceTime)) {
    throw new Error("Ninebot travel request header service-time must be a safe integer");
  }
  const platformVersion = fields.platform_ver.split(" ")[0];
  if (!platformVersion) throw new Error("Ninebot travel request header platform-ver is empty");
  return {
    accept: "application/json",
    "accept-encoding": "gzip",
    access_token: fields.access_token,
    "business-type": businessType,
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
    "rn-module": "Track",
    "rn-ver": fields.rnVersion,
    "rn-version": "0",
    "request-id": requestId,
    "service-time": String(serviceTime),
    "sys-language": fields.sys_language,
    uid: fields.uid,
    "user-agent": "okhttp/4.9.1",
  };
};

export interface TravelMonthResponseCandidate {
  code: number | string | null;
  detail: readonly unknown[];
  desc: string | null;
  duration: number | string | null;
  ec: number | string | null;
  first_time: number | string | null;
  list: readonly Record<string, unknown>[];
  month: string;
  times: number | string | null;
  total_mileages: number | string | null;
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
  throw new Error(`Ninebot travel response field ${key} is invalid`);
};

/** Parses the monthly travel JSON after the candidate response codec has decoded it. */
export const parseTravelMonthResponseCandidate = (
  plaintext: Uint8Array,
): TravelMonthResponseCandidate => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Ninebot travel response payload is not valid JSON");
  }
  const record = asRecord(parsed);
  if (!record) throw new Error("Ninebot travel response payload is not a JSON object");
  const nestedPayload = asRecord(record.data);
  const isWrapped = nestedPayload !== null && ("code" in record || "desc" in record);
  const payload = isWrapped ? nestedPayload : record;
  const code = isWrapped ? readScalar(record, "code") : null;
  const descValue = isWrapped ? record.desc : null;
  if (descValue !== null && typeof descValue !== "string") {
    throw new Error("Ninebot travel response field desc is invalid");
  }
  if (typeof payload.month !== "string" || !/^\d{6}$/.test(payload.month)) {
    throw new Error("Ninebot travel response field month is invalid");
  }
  if (!Array.isArray(payload.detail)) {
    throw new Error("Ninebot travel response field detail is invalid");
  }
  if (!Array.isArray(payload.list)) {
    throw new Error("Ninebot travel response field list is invalid");
  }
  const list = payload.list.flatMap((item) => {
    const row = asRecord(item);
    return row ? [row] : [];
  });
  return {
    ...payload,
    code,
    detail: payload.detail,
    desc: descValue,
    duration: readScalar(payload, "duration"),
    ec: readScalar(payload, "ec"),
    first_time: readScalar(payload, "first_time"),
    list,
    month: payload.month,
    times: readScalar(payload, "times"),
    total_mileages: readScalar(payload, "total_mileages"),
  };
};

export interface TravelDetailResponseCandidate {
  code: number | string | null;
  desc: string | null;
  [key: string]: unknown;
}

/** Parses the single-ride detail object, accepting travel-list2's business wrapper shape. */
export const parseTravelDetailResponseCandidate = (
  plaintext: Uint8Array,
): TravelDetailResponseCandidate => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Ninebot travel detail response payload is not valid JSON");
  }
  const record = asRecord(parsed);
  if (!record) throw new Error("Ninebot travel detail response payload is not a JSON object");
  const nestedPayload = asRecord(record.data);
  const isWrapped = nestedPayload !== null && ("code" in record || "desc" in record);
  const payload = isWrapped ? nestedPayload : record;
  const code = isWrapped ? readScalar(record, "code") : null;
  const descValue = isWrapped ? record.desc : null;
  if (descValue !== null && typeof descValue !== "string") {
    throw new Error("Ninebot travel detail response field desc is invalid");
  }
  if ("trail" in payload && typeof payload.trail !== "string") {
    throw new Error("Ninebot travel detail response field trail is invalid");
  }
  return { ...payload, code, desc: descValue };
};
