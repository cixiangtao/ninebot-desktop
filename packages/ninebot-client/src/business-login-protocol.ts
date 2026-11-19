import { computeNinebotBodyCheckcode } from "./protocol-checksum.ts";
import type { NinebotRequest } from "./transport.ts";
import type { NinebotEncryptedRequestEnvelope } from "./crypto-envelope.ts";
export interface NinebotBusinessLoginResponseCandidate<T = unknown> {
  code: number | string | null;
  data: T;
  desc: string | null;
  time_cost: number | null;
  extra: unknown;
}

export const parseBusinessLoginResponseCandidate = <T = unknown>(
  plaintext: Uint8Array,
): NinebotBusinessLoginResponseCandidate<T> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error("Ninebot business login response payload is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Ninebot business login response payload is not a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const code = record.code;
  if (code !== undefined && code !== null && typeof code !== "number" && typeof code !== "string") {
    throw new Error("Ninebot business login response field code is invalid");
  }
  const desc = record.desc;
  if (desc !== undefined && desc !== null && typeof desc !== "string") {
    throw new Error("Ninebot business login response field desc is invalid");
  }
  if (!("data" in record)) {
    throw new Error("Ninebot business login response field data is missing");
  }
  const timeCost = record.time_cost;
  if (timeCost !== undefined && timeCost !== null && typeof timeCost !== "number") {
    throw new Error("Ninebot business login response field time_cost is invalid");
  }
  return {
    code: code === undefined ? null : code,
    data: record.data as T,
    desc: desc === undefined ? null : desc,
    time_cost: timeCost === undefined ? null : timeCost,
    extra: record.extra ?? null,
  };
};

export const businessLoginPath = "/user/user/login" as const;
export const businessLoginProtocol = { p: "101", t: "0" } as const;

/** Plaintext fields observed at ninecli's business metadata bootstrap boundary. */
export interface BusinessLoginPlaintextFields {
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
  uuid: string;
  token: string;
  refresh_token: string;
  region: string;
  serviceTime: number;
  nonce: string;
}

const businessLoginKeys = [
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
  "uuid",
  "token",
  "refresh_token",
  "region",
  "serviceTime",
  "nonce",
] as const satisfies readonly (keyof BusinessLoginPlaintextFields)[];

const assertFields = (fields: BusinessLoginPlaintextFields) => {
  for (const key of businessLoginKeys) {
    const value = fields[key];
    if (typeof value !== "string" && typeof value !== "number") {
      throw new Error(`Ninebot business login field ${key} is invalid`);
    }
    if (typeof value === "string" && value.length === 0) {
      throw new Error(`Ninebot business login field ${key} is empty`);
    }
  }
  if (!Number.isSafeInteger(fields.serviceTime)) {
    throw new Error("Ninebot business login field serviceTime must be a safe integer");
  }
  if (!/^[0-9A-Fa-f]{32}$/.test(fields.nonce)) {
    throw new Error("Ninebot business login field nonce must be 32 hexadecimal characters");
  }
};

/** Builds the ordered business-login JSON and its uppercase MD5 checkcode. */
export const buildBusinessLoginPlaintextBody = (
  fields: BusinessLoginPlaintextFields,
): Uint8Array => {
  assertFields(fields);
  const unsigned = Object.fromEntries(
    businessLoginKeys.map((key) => [key, fields[key]]),
  ) as unknown as BusinessLoginPlaintextFields;
  const unsignedBody = JSON.stringify(unsigned);
  return new TextEncoder().encode(
    JSON.stringify({ ...unsigned, checkcode: computeNinebotBodyCheckcode(unsignedBody) }),
  );
};

export interface BuildBusinessLoginHeadersOptions {
  fields: BusinessLoginPlaintextFields;
  requestId: string;
}

/** Builds the business-login headers observed from ninecli 0.1.7. */
export const buildBusinessLoginHeaders = ({
  fields,
  requestId,
}: BuildBusinessLoginHeadersOptions) => {
  if (!/^[0-9A-Fa-f]{32}$/.test(requestId)) {
    throw new Error("Ninebot business login request-id must be 32 hexadecimal characters");
  }
  const platform = fields.platform.toLowerCase() === "android" ? "Android" : fields.platform;
  const platformVersion = fields.platform_ver.split(" ")[0];
  if (!platformVersion) throw new Error("Ninebot business login platform-ver is empty");
  return {
    "business-type": "0",
    "cache-control": "no-cache",
    "client-ver": fields.client_ver,
    "content-type": "application/json",
    "device-id": fields.device_id,
    debug: "0",
    language: fields.language,
    "login-country": fields.login_country,
    need_decrypt: "1",
    "ninebot-version": "2",
    platform,
    "platform-ver": platformVersion,
    regionx: fields.regionx,
    "request-id": requestId,
    "service-time": String(fields.serviceTime),
    "sys-language": fields.sys_language,
    "user-agent": "okhttp/4.9.1",
  };
};

export const buildBusinessLoginRequest = ({
  envelope,
  headers,
}: {
  envelope: NinebotEncryptedRequestEnvelope;
  headers?: Readonly<Record<string, string>>;
}): NinebotRequest => ({
  service: "business",
  method: "POST",
  path: businessLoginPath,
  headers: { "content-type": "application/json", ...headers },
  body: new TextEncoder().encode(JSON.stringify(envelope)),
});
