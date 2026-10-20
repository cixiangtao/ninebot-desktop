import type { NinebotPassportSession } from "./auth.ts";

/** Passport request shape shared with any transport implementation. */
export interface PassportRequest {
  service: "passport";
  method: "POST";
  path:
    | "/v5/user"
    | "/v6/user/login"
    | "/v3/user/refresh"
    | "/v4/code/phone"
    | "/v6/user/phoneCodeLogin";
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
}

export interface PassportSigningInput {
  method: "POST";
  path: "/v6/user/login";
  timestamp: string;
  clientId: string;
  clientKey: string;
  appVersion: string;
  os: string;
  osLanguage: string;
  osVersion: string;
  body: Uint8Array;
}

export type PassportRequestSigner = (input: PassportSigningInput) => string | Promise<string>;

export interface PassportRefreshSigningInput {
  method: "POST";
  path: "/v3/user/refresh";
  timestamp: string;
  clientId: string;
  clientKey: string;
  appVersion: string;
  os: string;
  osLanguage: string;
  osVersion: string;
  body: Uint8Array;
}

export type PassportRefreshRequestSigner = (
  input: PassportRefreshSigningInput,
) => string | Promise<string>;

export interface PassportWhoamiSigningInput {
  method: "POST";
  path: "/v5/user";
  timestamp: string;
  clientId: string;
  clientKey: string;
  appVersion: string;
  os: string;
  osLanguage: string;
  osVersion: string;
  body: Uint8Array;
}

export type PassportWhoamiRequestSigner = (
  input: PassportWhoamiSigningInput,
) => string | Promise<string>;

export interface BuildPasswordLoginRequestOptions {
  areaCode: string;
  username: string;
  password: string;
  clientId?: string;
  clientKey?: string;
  appVersion?: string;
  os?: string;
  osLanguage?: string;
  osVersion?: string;
  userAgent?: string;
  device?: string;
  timestampMs?: number;
  signer: PassportRequestSigner;
}

export interface BuildRefreshRequestOptions {
  accessToken: string;
  refreshToken: string;
  clientId?: string;
  clientKey?: string;
  appVersion?: string;
  os?: string;
  osLanguage?: string;
  osVersion?: string;
  userAgent?: string;
  device?: string;
  timestampMs?: number;
  signer: PassportRefreshRequestSigner;
}

export interface BuildPassportWhoamiRequestOptions {
  authorization: string;
  clientId?: string;
  clientKey?: string;
  appVersion?: string;
  os?: string;
  osLanguage?: string;
  osVersion?: string;
  userAgent?: string;
  timestampMs?: number;
  signer: PassportWhoamiRequestSigner;
}

const loginPath = "/v6/user/login" as const;
const textEncoder = new TextEncoder();

/** Static Passport client key observed in ninecli 0.1.7. */
export const defaultPassportClientKey = "e177176a-3b3e-1513-e26e-d1123034cb66";

/**
 * Builds the ordered query-string canonical form used by PassportSign.
 *
 * ninecli sorts all primitive fields by bytewise key order, then joins raw
 * values with `&`; values are not URL-encoded before hashing.
 */
export const buildPassportCanonicalString = ({
  path,
  timestamp,
  clientKey,
  appVersion,
  os,
  osLanguage,
  osVersion,
  body,
}: {
  path:
    | PassportSigningInput["path"]
    | PassportRefreshSigningInput["path"]
    | PassportWhoamiSigningInput["path"]
    | PassportSmsSigningInput["path"];
  timestamp: string;
  clientKey: string;
  appVersion: string;
  os: string;
  osLanguage: string;
  osVersion: string;
  body: Uint8Array;
}) => {
  const decoded = JSON.parse(new TextDecoder().decode(body)) as unknown;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("Ninebot Passport signing body must be a JSON object");
  }
  const fields: Record<string, string> = {
    app_version: appVersion,
    clientKey,
    os,
    os_language: osLanguage,
    os_version: osVersion,
    timestamp,
    url: path,
  };
  for (const [key, value] of Object.entries(decoded)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error(`Ninebot Passport signing field ${key} is not primitive`);
    }
    fields[key] = String(value);
  }
  return Object.keys(fields)
    .toSorted()
    .map((key) => `${key}=${fields[key]}`)
    .join("&");
};

/** Builds the verified password-login request shape observed from ninecli. */
export const buildPasswordLoginRequest = async ({
  areaCode,
  username,
  password,
  clientId = "vehicle_app_prod",
  clientKey = defaultPassportClientKey,
  appVersion = "610063322",
  os = "Android",
  osLanguage = "zh-hans-cn",
  osVersion = "13",
  userAgent = "ninebot-client",
  device = "ANDROID",
  timestampMs = Date.now(),
  signer,
}: BuildPasswordLoginRequestOptions): Promise<PassportRequest> => {
  const body = textEncoder.encode(JSON.stringify({ areaCode, device, password, username }));
  const timestamp = String(timestampMs);
  const sign = await signer({
    method: "POST",
    path: loginPath,
    timestamp,
    clientId,
    clientKey,
    appVersion,
    os,
    osLanguage,
    osVersion,
    body: body.slice(),
  });
  return {
    service: "passport",
    method: "POST",
    path: loginPath,
    headers: {
      "accept-encoding": "gzip",
      app_version: appVersion,
      clientid: clientId,
      "content-type": "application/json; charset=UTF-8",
      os,
      os_language: osLanguage,
      os_version: osVersion,
      sign,
      timestamp,
      "user-agent": userAgent,
    },
    body,
  };
};

/** Builds the verified Passport refresh request shape observed from ninecli. */
export const buildRefreshRequest = async ({
  accessToken,
  refreshToken,
  clientId = "vehicle_app_prod",
  clientKey = defaultPassportClientKey,
  appVersion = "610063322",
  os = "Android",
  osLanguage = "zh-hans-cn",
  osVersion = "13",
  userAgent = "ninebot-client",
  device = "ANDROID",
  timestampMs = Date.now(),
  signer,
}: BuildRefreshRequestOptions): Promise<PassportRequest> => {
  const body = textEncoder.encode(JSON.stringify({ accessToken, device, refreshToken }));
  const timestamp = String(timestampMs);
  const sign = await signer({
    method: "POST",
    path: "/v3/user/refresh",
    timestamp,
    clientId,
    clientKey,
    appVersion,
    os,
    osLanguage,
    osVersion,
    body: body.slice(),
  });
  return {
    service: "passport",
    method: "POST",
    path: "/v3/user/refresh",
    headers: {
      "accept-encoding": "gzip",
      app_version: appVersion,
      clientid: clientId,
      "content-type": "application/json; charset=UTF-8",
      os,
      os_language: osLanguage,
      os_version: osVersion,
      sign,
      timestamp,
      "user-agent": userAgent,
    },
    body,
  };
};

/** Builds the verified Passport profile request shape observed from ninecli. */
export const buildWhoamiPassportRequest = async ({
  authorization,
  clientId = "vehicle_app_prod",
  clientKey = defaultPassportClientKey,
  appVersion = "610063322",
  os = "Android",
  osLanguage = "zh-hans-cn",
  osVersion = "13",
  userAgent = "ninebot-client",
  timestampMs = Date.now(),
  signer,
}: BuildPassportWhoamiRequestOptions): Promise<PassportRequest> => {
  const body = textEncoder.encode("{}");
  const timestamp = String(timestampMs);
  const sign = await signer({
    method: "POST",
    path: "/v5/user",
    timestamp,
    clientId,
    clientKey,
    appVersion,
    os,
    osLanguage,
    osVersion,
    body: body.slice(),
  });
  return {
    service: "passport",
    method: "POST",
    path: "/v5/user",
    headers: {
      accept: "application/json",
      "accept-encoding": "gzip",
      app_version: appVersion,
      authorization,
      clientid: clientId,
      "content-type": "application/json; charset=UTF-8",
      os,
      os_language: osLanguage,
      os_version: osVersion,
      sign,
      timestamp,
      "user-agent": userAgent,
    },
    body,
  };
};

interface PassportLoginData {
  access_token?: unknown;
  refresh_token?: unknown;
  uuid?: unknown;
  accessTokenValidity?: unknown;
}

const requireText = (value: unknown, field: string) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Ninebot passport response field ${field} is invalid`);
  }
  return value;
};

const readExpiry = (value: unknown) => {
  if (value === undefined || value === null) return undefined;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Ninebot passport response field accessTokenValidity is invalid");
  }
  // The Passport response has appeared in both Unix seconds and milliseconds.
  return parsed < 1_000_000_000_000 ? parsed * 1_000 : parsed;
};

/** Parses account tokens only; Passport uid fields never establish business identity. */
export const parsePassportLoginSession = (data: unknown): NinebotPassportSession => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Ninebot passport login response data is invalid");
  }
  const record = data as PassportLoginData;
  const expiresAtMs = readExpiry(record.accessTokenValidity);
  return {
    accessToken: requireText(record.access_token, "access_token"),
    refreshToken: requireText(record.refresh_token, "refresh_token"),
    ...(record.uuid === undefined ? {} : { uuid: requireText(record.uuid, "uuid") }),
    ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
  };
};

/** Parses replacement account tokens, retaining UUID/expiry when upstream omits them. */
export const parsePassportRefreshSession = (
  data: unknown,
  previous: NinebotPassportSession,
): NinebotPassportSession => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Ninebot passport refresh response data is invalid");
  }
  const record = data as PassportLoginData;
  const expiresAtMs = readExpiry(record.accessTokenValidity) ?? previous.expiresAtMs;
  const uuid = record.uuid ?? previous.uuid;
  return {
    accessToken: requireText(record.access_token, "access_token"),
    refreshToken: requireText(record.refresh_token, "refresh_token"),
    ...(uuid === undefined ? {} : { uuid: requireText(uuid, "uuid") }),
    ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
  };
};

/** Request/signature contract observed in saved ninecli SMS fixtures. */
export interface PassportSmsSigningInput extends Omit<PassportSigningInput, "path"> {
  path: "/v4/code/phone" | "/v6/user/phoneCodeLogin";
}
export type PassportSmsRequestSigner = (input: PassportSmsSigningInput) => string | Promise<string>;
export interface BuildPassportSmsRequestOptions {
  areaCode: string;
  phone: string;
  code?: string;
  region?: string;
  timestampMs?: number;
  signer: PassportSmsRequestSigner;
}

/** Omission of code sends SMS; consumption explicitly requires a nonempty code. */
export const buildPassportSmsRequest = async ({
  areaCode,
  phone,
  code,
  region = "bj",
  timestampMs = Date.now(),
  signer,
}: BuildPassportSmsRequestOptions): Promise<PassportRequest> => {
  if (
    !/^\d{1,4}$/.test(areaCode) ||
    !/^\d{5,20}$/.test(phone) ||
    (code !== undefined && !/^\d{4,8}$/.test(code))
  ) {
    throw new Error("Invalid Passport SMS input");
  }
  const path = code === undefined ? "/v4/code/phone" : "/v6/user/phoneCodeLogin";
  const body = textEncoder.encode(
    JSON.stringify(
      code === undefined
        ? { account: phone, areaCode, rawTemplate: "login" }
        : { areaCode, code, device: "ANDROID", phone, region },
    ),
  );
  const timestamp = String(timestampMs);
  const metadata = {
    clientId: "vehicle_app_prod",
    clientKey: defaultPassportClientKey,
    appVersion: "610063322",
    os: "Android",
    osLanguage: "zh-hans-cn",
    osVersion: "13",
  };
  const sign = await signer({ method: "POST", path, timestamp, body: body.slice(), ...metadata });
  return {
    service: "passport",
    method: "POST",
    path,
    body,
    headers: {
      "accept-encoding": "gzip",
      app_version: metadata.appVersion,
      clientid: metadata.clientId,
      "content-type": "application/json; charset=UTF-8",
      os: metadata.os,
      os_language: metadata.osLanguage,
      os_version: metadata.osVersion,
      sign,
      timestamp,
      "user-agent": "ninebot-client",
    },
  };
};
