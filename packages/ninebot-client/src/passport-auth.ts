import type { NinebotAuthSession } from "./auth.ts";

/** Passport request shape shared with any transport implementation. */
export interface PassportRequest {
  service: "passport";
  method: "POST";
  path: "/v5/user" | "/v6/user/login" | "/v3/user/refresh";
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
    | PassportWhoamiSigningInput["path"];
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
  business_uid?: unknown;
  uid?: unknown;
}

const requireText = (value: unknown, field: string) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Ninebot passport response field ${field} is invalid`);
  }
  return value;
};

/** Converts a verified Passport login data object into the shared session contract. */
export const parsePassportLoginSession = (data: unknown): NinebotAuthSession => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Ninebot passport login response data is invalid");
  }
  const record = data as PassportLoginData;
  const businessUid = record.business_uid ?? record.uid;
  return {
    accessToken: requireText(record.access_token, "access_token"),
    refreshToken: requireText(record.refresh_token, "refresh_token"),
    businessUid: requireText(businessUid, "business_uid"),
  };
};

/** Parses refresh data while retaining the prior business uid when the response omits it. */
export const parsePassportRefreshSession = (
  data: unknown,
  previousBusinessUid: string,
): NinebotAuthSession => {
  if (!previousBusinessUid.trim()) throw new Error("Ninebot passport business uid is invalid");
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Ninebot passport refresh response data is invalid");
  }
  const record = data as PassportLoginData;
  return {
    accessToken: requireText(record.access_token, "access_token"),
    refreshToken: requireText(record.refresh_token, "refresh_token"),
    businessUid: requireText(record.business_uid ?? previousBusinessUid, "business_uid"),
  };
};
