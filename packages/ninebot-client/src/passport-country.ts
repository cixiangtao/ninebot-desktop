import { defaultPassportClientKey, type PassportSigningInput } from "./passport-auth.ts";
import { createNinebotPassportWebSigner } from "./passport-signer.ts";
import type { PassportResponse } from "./passport-login-client.ts";

/** Portable boundary, structurally compatible with the existing Ninebot transport. */
export interface PassportCountryRequest {
  service: "passport";
  method: "GET" | "POST";
  path: string;
  headers: Readonly<Record<string, string>>;
  body?: Uint8Array;
  signal?: AbortSignal;
}
export interface PassportCountryTransport {
  send(request: PassportCountryRequest): Promise<PassportResponse>;
}

export type PassportCountryListPath =
  | "/v4/country_mutil_c.json"
  | "/v4/country_mutil_cn.json"
  | "/v5/country_mutil_c.json"
  | "/v5/country_mutil_cn.json";

export interface PassportCountrySigningInput extends Omit<PassportSigningInput, "path" | "method"> {
  method: "GET" | "POST";
  path: PassportCountryListPath;
}
export type PassportCountryRequestSigner = (
  input: PassportCountrySigningInput,
) => string | Promise<string>;

export interface PassportCountryListInput {
  /** APK Java int passed as v; cache/version semantics have not been observed online. */
  version: number;
  /** Explicit choice: the APK supports both generations; no automatic fallback. */
  generation: "v4" | "v5";
  orderByChinese?: boolean;
  signal?: AbortSignal;
}

export interface PassportCountryRequestOptions extends PassportCountryListInput {
  signer: PassportCountryRequestSigner;
  clientId?: string;
  clientKey?: string;
  appVersion?: string;
  os?: string;
  osLanguage?: string;
  osVersion?: string;
  userAgent?: string;
  timestampMs?: number;
}

/** Static APK contract; no account, token, phone number or location is accepted. */
export const buildPassportCountryListRequest = async ({
  version,
  generation,
  orderByChinese = false,
  signal,
  signer,
  clientId = "vehicle_app_prod",
  clientKey = defaultPassportClientKey,
  appVersion = "610063322",
  os = "Android",
  osLanguage = "zh-hans-cn",
  osVersion = "13",
  userAgent = "ninebot-client",
  timestampMs = Date.now(),
}: PassportCountryRequestOptions): Promise<PassportCountryRequest> => {
  if (!Number.isInteger(version) || version < -2_147_483_648 || version > 2_147_483_647)
    throw new Error("Passport country version must be a Java int");
  if ((generation !== "v4" && generation !== "v5") || typeof orderByChinese !== "boolean")
    throw new Error("Invalid Passport country directory variant");
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0)
    throw new Error("Invalid Passport country timestamp");
  const path: PassportCountryListPath = `/${generation}/country_mutil_${orderByChinese ? "cn" : "c"}.json`;
  const method = generation === "v5" ? "POST" : "GET";
  // GET signs the same parameter map, but sends it in the query, without a body.
  const body = new TextEncoder().encode(JSON.stringify({ v: String(version) }));
  const timestamp = String(timestampMs);
  const metadata = { clientId, clientKey, appVersion, os, osLanguage, osVersion };
  const sign = await signer({ method, path, timestamp, ...metadata, body: body.slice() });
  return {
    service: "passport",
    method,
    path: method === "GET" ? `${path}?v=${version}` : path,
    headers: {
      app_version: appVersion,
      clientid: clientId,
      ...(method === "POST" ? { "content-type": "application/json; charset=UTF-8" } : {}),
      os,
      os_language: osLanguage,
      os_version: osVersion,
      sign,
      timestamp,
      "user-agent": userAgent,
    },
    ...(method === "POST" ? { body } : {}),
    ...(signal === undefined ? {} : { signal }),
  };
};

export interface PassportCountryInfo {
  areaCode: string | null;
  isoCode: string | null;
  enName: string | null;
  zhName: string | null;
  /** Opaque wire strings; their business interpretation is not established. */
  region: string | null;
  limit: string | null;
  firstWord: string | null;
}
export interface PassportCountryDirectory {
  version: string | null;
  /** Null is preserved; it does not mean an empty directory or a cache hit. */
  countriesByGroup: Readonly<Record<string, readonly PassportCountryInfo[]>> | null;
}
export interface PassportCountryResult {
  resultCode: string | null;
  data: PassportCountryDirectory | null;
}

const object = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Passport country response object");
  return value as Record<string, unknown>;
};
const nullableString = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Error("Invalid Passport country response string");
  return value;
};

/** Decodes APK Gson names; does not infer success, cache behavior or country semantics. */
export const parsePassportCountryResult = (value: unknown): PassportCountryResult => {
  const result = object(value);
  const resultCode = nullableString(result.resultCode);
  if (result.data === undefined || result.data === null) return { resultCode, data: null };
  const data = object(result.data);
  const version = nullableString(data.version);
  if (data.countryList === undefined || data.countryList === null)
    return { resultCode, data: { version, countriesByGroup: null } };
  const groups = object(data.countryList);
  const entries = Object.entries(groups).map(([key, countries]) => {
    if (!Array.isArray(countries)) throw new Error("Invalid Passport country response group");
    return [
      key,
      countries.map((countryValue): PassportCountryInfo => {
        const country = object(countryValue);
        return {
          areaCode: nullableString(country.N),
          isoCode: nullableString(country.B),
          enName: nullableString(country.C_en),
          zhName: nullableString(country.C_zh),
          region: nullableString(country.R),
          limit: nullableString(country.limit),
          firstWord: nullableString(country.firstWord),
        };
      }),
    ] as const;
  });
  return { resultCode, data: { version, countriesByGroup: Object.fromEntries(entries) } };
};

export class PassportCountryHttpError extends Error {
  constructor(readonly status: number) {
    super(`Passport country directory failed with HTTP ${status}`);
    this.name = "PassportCountryHttpError";
  }
}

export interface PassportCountryClientOptions extends Omit<
  PassportCountryRequestOptions,
  keyof PassportCountryListInput | "signer" | "timestampMs"
> {
  transport: PassportCountryTransport;
  signer?: PassportCountryRequestSigner;
  now?: () => number;
  responseBodyDecoder?: (response: PassportResponse) => Uint8Array | Promise<Uint8Array>;
}

/** Caller owns service origins, server-code policy and caching. Construction performs no I/O. */
export const createNinebotPassportCountryClient = ({
  transport,
  signer = createNinebotPassportWebSigner().country,
  now = Date.now,
  responseBodyDecoder = (response) => response.body,
  ...metadata
}: PassportCountryClientOptions) => ({
  async list(input: PassportCountryListInput): Promise<PassportCountryResult> {
    const request = await buildPassportCountryListRequest({
      ...metadata,
      ...input,
      signer,
      timestampMs: now(),
    });
    const response = await transport.send(request);
    if (response.status < 200 || response.status >= 300)
      throw new PassportCountryHttpError(response.status);
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(await responseBodyDecoder(response)));
    } catch {
      // Do not retain upstream text or JSON parser excerpts in thrown errors.
      throw new Error("Invalid Passport country JSON response");
    }
    return parsePassportCountryResult(parsed);
  },
});
