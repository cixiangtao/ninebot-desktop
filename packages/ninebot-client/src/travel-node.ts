import { computeNinebotBodyCheckcode, generateNinebotNonce } from "./crypto-node.ts";
import {
  buildNinebotEncryptedRequestCandidate,
  decryptNinebotResponsePayloadCandidate,
  generateNinebotCandidateRequestMaterial,
} from "./crypto-codec.ts";
import type { NinebotCandidateKeyData } from "./crypto-codec.ts";
import type {
  NinebotEncryptedRequestEnvelope,
  NinebotEncryptedResponseEnvelope,
} from "./crypto-envelope.ts";
import { ninebotCandidateRsaPublicKeyPem } from "./rsa-node.ts";
import { ninebotVehicleCandidateProtocol } from "./vehicle-node.ts";

/** Fields observed in the plaintext sent to the monthly travel endpoint. */
export interface TravelMonthPlaintextFields {
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
  wnumber: string;
  rnVersion: string;
  vehicle_type: string;
  month: string;
  page: string;
  current_version: string;
  serviceTime: number;
  nonce: string;
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
export const buildTravelMonthPlaintextBody = (fields: TravelMonthPlaintextFields) => {
  assertTravelMonthPlaintextFields(fields);
  const unsignedFields = Object.fromEntries(
    travelMonthPlaintextKeys.map((key) => [key, fields[key]]),
  ) as unknown as TravelMonthPlaintextFields;
  const unsignedBody = JSON.stringify(unsignedFields);
  const body = { ...unsignedFields, checkcode: computeNinebotBodyCheckcode(unsignedBody) };
  return new TextEncoder().encode(JSON.stringify(body));
};

export interface BuildTravelCandidateHeadersOptions {
  fields: TravelMonthPlaintextFields;
  /** Ninebot business line: `1` for motor and `2` for ebike. */
  businessType: "1" | "2";
  requestId?: string;
  serviceTime?: number;
}

/** Builds the observed request headers for the travel service. */
export const buildTravelCandidateHeaders = ({
  fields,
  businessType,
  requestId = generateNinebotNonce(),
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

export interface BuildTravelMonthEncryptedRequestCandidateOptions {
  fields: TravelMonthPlaintextFields;
  platform: number;
  p?: string;
  t?: string;
  timeStamp?: number;
  /** Defaults to the public key embedded in ninecli 0.1.7. */
  rsaPublicKey?: Uint8Array | string;
}

export interface TravelMonthEncryptedRequestCandidate {
  envelope: NinebotEncryptedRequestEnvelope;
  keyData: NinebotCandidateKeyData;
}

/** Builds a monthly travel candidate and returns the response key context. */
export const buildTravelMonthEncryptedRequestCandidate = ({
  fields,
  platform,
  p = ninebotVehicleCandidateProtocol.p,
  t = ninebotVehicleCandidateProtocol.t,
  timeStamp,
  rsaPublicKey,
}: BuildTravelMonthEncryptedRequestCandidateOptions): TravelMonthEncryptedRequestCandidate => {
  const material = generateNinebotCandidateRequestMaterial(
    timeStamp === undefined ? { platform, p, t } : { platform, p, t, timeStamp },
  );
  return {
    envelope: buildNinebotEncryptedRequestCandidate({
      plaintextBody: buildTravelMonthPlaintextBody(fields),
      material,
      rsaPublicKey: rsaPublicKey ?? ninebotCandidateRsaPublicKeyPem,
    }),
    keyData: material.keyData,
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

/** Decrypts and parses one monthly travel response with its request-specific key context. */
export const decodeTravelMonthResponseCandidate = ({
  envelope,
  keyData,
}: {
  envelope: NinebotEncryptedResponseEnvelope;
  keyData: NinebotCandidateKeyData;
}) =>
  parseTravelMonthResponseCandidate(decryptNinebotResponsePayloadCandidate({ envelope, keyData }));
