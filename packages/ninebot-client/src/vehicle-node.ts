import { computeNinebotBodyCheckcode } from "./crypto-node.ts";
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
import {
  decodeVehicleListResponseWithCodec,
  type DecodeVehicleListResponseWithCodecOptions,
  type NinebotVehicleCodec,
} from "./vehicle-codec.ts";
import { createNinebotVehicleClient } from "./vehicle-client.ts";
import type { NinebotResponse, NinebotTransport } from "./transport.ts";

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
export const buildVehicleListPlaintextBody = (fields: VehicleListPlaintextFields) => {
  assertVehicleListPlaintextFields(fields);
  const unsignedFields = Object.fromEntries(
    vehicleListPlaintextKeys.map((key) => [key, fields[key]]),
  ) as unknown as VehicleListPlaintextFields;
  const unsignedBody = JSON.stringify(unsignedFields);
  const body = { ...unsignedFields, checkcode: computeNinebotBodyCheckcode(unsignedBody) };
  return new TextEncoder().encode(JSON.stringify(body));
};

export interface BuildVehicleListEncryptedRequestCandidateOptions {
  fields: VehicleListPlaintextFields;
  platform: number;
  p: string;
  t: string;
  timeStamp?: number;
  /** Defaults to the public key embedded in ninecli 0.1.7. */
  rsaPublicKey?: Uint8Array | string;
}

export interface VehicleListEncryptedRequestCandidate {
  envelope: NinebotEncryptedRequestEnvelope;
  keyData: ReturnType<typeof generateNinebotCandidateRequestMaterial>["keyData"];
}

/** Builds one encrypted vehicle-list candidate and returns its response key context. */
export const buildVehicleListEncryptedRequestCandidate = ({
  fields,
  platform,
  p,
  t,
  timeStamp,
  rsaPublicKey,
}: BuildVehicleListEncryptedRequestCandidateOptions): VehicleListEncryptedRequestCandidate => {
  const material = generateNinebotCandidateRequestMaterial(
    timeStamp === undefined ? { platform, p, t } : { platform, p, t, timeStamp },
  );
  return {
    envelope: buildNinebotEncryptedRequestCandidate({
      plaintextBody: buildVehicleListPlaintextBody(fields),
      material,
      rsaPublicKey: rsaPublicKey ?? ninebotCandidateRsaPublicKeyPem,
    }),
    keyData: material.keyData,
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

/** Decrypts and parses one vehicle-list response while retaining the key context boundary. */
export const decodeVehicleListResponseCandidate = <T = unknown>({
  envelope,
  keyData,
}: {
  envelope: NinebotEncryptedResponseEnvelope;
  keyData: Parameters<typeof decryptNinebotResponsePayloadCandidate>[0]["keyData"];
}) =>
  parseVehicleListResponseCandidate<T>(
    decryptNinebotResponsePayloadCandidate({ envelope, keyData }),
  );

/**
 * Decodes a vehicle response through a codec and parses its business wrapper.
 *
 * The helper keeps transport/envelope handling in the shared codec boundary while
 * exposing the candidate response metadata to Node callers that are comparing the
 * TypeScript path with ninecli.
 */
export const decodeVehicleListResponseCandidateWithCodec = async <T = unknown>({
  service,
  responseBody,
  codec,
  responseContext,
}: DecodeVehicleListResponseWithCodecOptions): Promise<NinebotVehicleResponseCandidate<T>> =>
  parseVehicleListResponseCandidate<T>(
    await decodeVehicleListResponseWithCodec({
      service,
      responseBody,
      codec,
      responseContext,
    }),
  );

export interface CreateNinebotVehicleCandidateCodecOptions {
  platform: number;
  p: string;
  t: string;
  timeStamp?: number;
  /** Defaults to the public key embedded in ninecli 0.1.7. */
  rsaPublicKey?: Uint8Array | string;
}

const readResponseKeyData = (context: unknown) => {
  if (context === null || typeof context !== "object") {
    throw new Error("Ninebot vehicle response context is missing");
  }
  const record = context as Record<string, unknown>;
  const keyData = {
    keyDataOne: record.keyDataOne,
    keyDataTwo: record.keyDataTwo,
    keyDataThree: record.keyDataThree,
    keyDataFour: record.keyDataFour,
  };
  if (
    typeof keyData.keyDataOne !== "string" ||
    typeof keyData.keyDataTwo !== "string" ||
    typeof keyData.keyDataThree !== "string" ||
    typeof keyData.keyDataFour !== "string"
  ) {
    throw new Error("Ninebot vehicle response context is invalid");
  }
  return keyData as NinebotCandidateKeyData;
};

/** Creates a context-safe Node candidate codec for the high-level vehicle client. */
export const createNinebotVehicleCandidateCodec = ({
  platform,
  p,
  t,
  timeStamp,
  rsaPublicKey,
}: CreateNinebotVehicleCandidateCodecOptions): NinebotVehicleCodec => ({
  async encodeRequest({ plaintextBody }) {
    const material = generateNinebotCandidateRequestMaterial(
      timeStamp === undefined ? { platform, p, t } : { platform, p, t, timeStamp },
    );
    return {
      envelope: buildNinebotEncryptedRequestCandidate({
        plaintextBody,
        material,
        rsaPublicKey: rsaPublicKey ?? ninebotCandidateRsaPublicKeyPem,
      }),
      responseContext: material.keyData,
    };
  },
  async decodeResponse({ envelope, responseContext }) {
    return decryptNinebotResponsePayloadCandidate({
      envelope,
      keyData: readResponseKeyData(responseContext),
    });
  },
});

export interface CreateNinebotVehicleCandidateClientOptions extends CreateNinebotVehicleCandidateCodecOptions {
  transport: NinebotTransport;
  responseBodyDecoder?: (response: NinebotResponse) => Uint8Array | Promise<Uint8Array>;
}

export interface ListNinebotVehicleCandidateOptions {
  service: "ebike" | "motor";
  fields: VehicleListPlaintextFields;
  headers?: Readonly<Record<string, string>>;
}

/**
 * Creates a Node candidate client that builds and parses the complete vehicle-list flow.
 *
 * The transport remains injectable so a caller can use a local recorder or a real
 * HTTP implementation. This helper is still a candidate boundary and does not
 * change the Electron client's default ninecli implementation.
 */
export const createNinebotVehicleCandidateClient = ({
  transport,
  responseBodyDecoder,
  ...codecOptions
}: CreateNinebotVehicleCandidateClientOptions) => {
  const codec = createNinebotVehicleCandidateCodec(codecOptions);
  const client = createNinebotVehicleClient({
    transport,
    codec,
    ...(responseBodyDecoder ? { responseBodyDecoder } : {}),
  });
  return {
    async list<T = unknown>({ service, fields, headers = {} }: ListNinebotVehicleCandidateOptions) {
      const plaintextBody = buildVehicleListPlaintextBody(fields);
      const payload = await client.list({ service, plaintextBody, headers });
      return parseVehicleListResponseCandidate<T>(payload);
    },
  };
};
