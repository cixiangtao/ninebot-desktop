import { computeNinebotBodyCheckcode, generateNinebotNonce } from "./crypto-node.ts";
import {
  buildNinebotEncryptedRequestCandidate,
  decryptNinebotResponsePayloadCandidate,
  generateNinebotCandidateRequestMaterial,
  type NinebotCandidateKeyData,
} from "./crypto-codec.ts";
import { ninebotCandidateRsaPublicKeyPem } from "./rsa-node.ts";
import {
  parseNinebotEncryptedResponse,
  type NinebotEncryptedRequestEnvelope,
} from "./crypto-envelope.ts";
import type { NinebotResponse, NinebotRequest, NinebotTransport } from "./transport.ts";
import {
  parseVehicleListResponseCandidate,
  type NinebotVehicleResponseCandidate,
} from "./vehicle-node.ts";

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
export const buildBusinessLoginPlaintextBody = (fields: BusinessLoginPlaintextFields) => {
  assertFields(fields);
  const unsigned = Object.fromEntries(
    businessLoginKeys.map((key) => [key, fields[key]]),
  ) as unknown as BusinessLoginPlaintextFields;
  const unsignedBody = JSON.stringify(unsigned);
  return new TextEncoder().encode(
    JSON.stringify({ ...unsigned, checkcode: computeNinebotBodyCheckcode(unsignedBody) }),
  );
};

export interface BuildBusinessLoginEncryptedRequestOptions {
  fields: BusinessLoginPlaintextFields;
  platform?: number;
  p?: string;
  t?: string;
  timeStamp?: number;
  rsaPublicKey?: Uint8Array | string;
}

export interface BusinessLoginEncryptedRequest {
  envelope: NinebotEncryptedRequestEnvelope;
  keyData: NinebotCandidateKeyData;
}

export const buildBusinessLoginEncryptedRequest = ({
  fields,
  platform = 2,
  p = businessLoginProtocol.p,
  t = businessLoginProtocol.t,
  timeStamp,
  rsaPublicKey = ninebotCandidateRsaPublicKeyPem,
}: BuildBusinessLoginEncryptedRequestOptions): BusinessLoginEncryptedRequest => {
  const material = generateNinebotCandidateRequestMaterial(
    timeStamp === undefined ? { platform, p, t } : { platform, p, t, timeStamp },
  );
  return {
    envelope: buildNinebotEncryptedRequestCandidate({
      plaintextBody: buildBusinessLoginPlaintextBody(fields),
      material,
      rsaPublicKey,
    }),
    keyData: material.keyData,
  };
};

export interface BuildBusinessLoginHeadersOptions {
  fields: BusinessLoginPlaintextFields;
  requestId?: string;
}

/** Builds the business-login headers observed from ninecli 0.1.7. */
export const buildBusinessLoginHeaders = ({
  fields,
  requestId = generateNinebotNonce(),
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

const readKeyData = (value: unknown): NinebotCandidateKeyData => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Ninebot business login response context is missing");
  }
  const record = value as Record<string, unknown>;
  for (const key of ["keyDataOne", "keyDataTwo", "keyDataThree", "keyDataFour"] as const) {
    if (typeof record[key] !== "string")
      throw new Error("Ninebot business login response context is invalid");
  }
  return record as unknown as NinebotCandidateKeyData;
};

export const decodeBusinessLoginResponse = <T = unknown>({
  responseBody,
  keyData,
}: {
  responseBody: Uint8Array | string;
  keyData: NinebotCandidateKeyData;
}): NinebotVehicleResponseCandidate<T> =>
  parseVehicleListResponseCandidate<T>(
    decryptNinebotResponsePayloadCandidate({
      envelope: parseNinebotEncryptedResponse(responseBody),
      keyData,
    }),
  );

export interface CreateBusinessLoginClientOptions {
  transport: NinebotTransport;
  platform?: number;
  rsaPublicKey?: Uint8Array | string;
}

/** Executes the encrypted metadata bootstrap while retaining per-request key context. */
export const createBusinessLoginClient = ({
  transport,
  platform = 2,
  rsaPublicKey,
}: CreateBusinessLoginClientOptions) => ({
  async login<T = unknown>(fields: BusinessLoginPlaintextFields, signal?: AbortSignal) {
    const requestFields = { ...fields, serviceTime: fields.serviceTime };
    const encoded = buildBusinessLoginEncryptedRequest({
      fields: requestFields,
      platform,
      ...(rsaPublicKey === undefined ? {} : { rsaPublicKey }),
    });
    const response: NinebotResponse = await transport.send({
      ...buildBusinessLoginRequest({
        envelope: encoded.envelope,
        headers: buildBusinessLoginHeaders({ fields: requestFields }),
      }),
      ...(signal === undefined ? {} : { signal }),
    });
    return decodeBusinessLoginResponse<T>({
      responseBody: response.body,
      keyData: encoded.keyData,
    });
  },
});

export type BusinessLoginKeyData = ReturnType<typeof readKeyData>;
