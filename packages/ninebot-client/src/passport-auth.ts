import type { NinebotAuthSession } from "./auth.ts";

/** Passport request shape shared with any transport implementation. */
export interface PassportRequest {
  service: "passport";
  method: "POST";
  path: "/v6/user/login" | "/v3/user/refresh";
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
}

export interface PassportSigningInput {
  method: "POST";
  path: "/v6/user/login";
  timestamp: string;
  clientId: string;
  body: Uint8Array;
}

export type PassportRequestSigner = (input: PassportSigningInput) => string | Promise<string>;

export interface PassportRefreshSigningInput {
  method: "POST";
  path: "/v3/user/refresh";
  timestamp: string;
  clientId: string;
  body: Uint8Array;
}

export type PassportRefreshRequestSigner = (
  input: PassportRefreshSigningInput,
) => string | Promise<string>;

export interface BuildPasswordLoginRequestOptions {
  areaCode: string;
  username: string;
  password: string;
  clientId?: string;
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
  appVersion?: string;
  os?: string;
  osLanguage?: string;
  osVersion?: string;
  userAgent?: string;
  device?: string;
  timestampMs?: number;
  signer: PassportRefreshRequestSigner;
}

const loginPath = "/v6/user/login" as const;
const textEncoder = new TextEncoder();

/** Builds the verified password-login request shape observed from ninecli. */
export const buildPasswordLoginRequest = async ({
  areaCode,
  username,
  password,
  clientId = "vehicle_app_prod",
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
