import {
  ninebotVehicleCandidateProtocol,
  type VehicleListPlaintextFields,
  buildVehicleListPlaintextBody,
  type BuildVehicleListCandidateHeadersOptions as BuildVehicleListCandidateHeadersOptionsProtocol,
  buildVehicleListCandidateHeaders as buildVehicleListCandidateHeadersProtocol,
  type NinebotVehicleResponseCandidate,
  parseVehicleListResponseCandidate,
} from "./vehicle-protocol.ts";
export {
  ninebotVehicleCandidateProtocol,
  type VehicleListPlaintextFields,
  buildVehicleListPlaintextBody,
  type NinebotVehicleResponseCandidate,
  parseVehicleListResponseCandidate,
} from "./vehicle-protocol.ts";
export type BuildVehicleListCandidateHeadersOptions = Omit<
  BuildVehicleListCandidateHeadersOptionsProtocol,
  "requestId"
> & { requestId?: string };
export const buildVehicleListCandidateHeaders = (
  options: Omit<BuildVehicleListCandidateHeadersOptions, "requestId"> & { requestId?: string },
) =>
  buildVehicleListCandidateHeadersProtocol({
    ...options,
    requestId: options.requestId ?? generateNinebotNonce(),
  });
import { generateNinebotNonce } from "./crypto-node.ts";
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

export interface BuildVehicleListEncryptedRequestCandidateOptions {
  fields: VehicleListPlaintextFields;
  platform: number;
  p?: string;
  t?: string;
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
  p = ninebotVehicleCandidateProtocol.p,
  t = ninebotVehicleCandidateProtocol.t,
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
  p?: string;
  t?: string;
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
  p = ninebotVehicleCandidateProtocol.p,
  t = ninebotVehicleCandidateProtocol.t,
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
  signal?: AbortSignal;
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
    async list<T = unknown>({
      service,
      fields,
      headers = {},
      signal,
    }: ListNinebotVehicleCandidateOptions) {
      const plaintextBody = buildVehicleListPlaintextBody(fields);
      const payload = await client.list({
        service,
        plaintextBody,
        headers: { ...buildVehicleListCandidateHeaders({ service, fields }), ...headers },
        ...(signal === undefined ? {} : { signal }),
      });
      return parseVehicleListResponseCandidate<T>(payload);
    },
  };
};
