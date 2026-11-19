import {
  travelMonthPath,
  travelDetailPath,
  type TravelCandidateHeaderFields,
  type TravelMonthPlaintextFields,
  buildTravelMonthPlaintextBody,
  type TravelDetailPlaintextFields,
  buildTravelDetailPlaintextBody,
  type BuildTravelCandidateHeadersOptions as BuildTravelCandidateHeadersOptionsProtocol,
  buildTravelCandidateHeaders as buildTravelCandidateHeadersProtocol,
  parseTravelMonthResponseCandidate,
  parseTravelDetailResponseCandidate,
} from "./travel-protocol.ts";
export {
  travelMonthPath,
  travelDetailPath,
  type TravelCandidateHeaderFields,
  type TravelMonthPlaintextFields,
  buildTravelMonthPlaintextBody,
  type TravelDetailPlaintextFields,
  buildTravelDetailPlaintextBody,
  type TravelMonthResponseCandidate,
  parseTravelMonthResponseCandidate,
  type TravelDetailResponseCandidate,
  parseTravelDetailResponseCandidate,
} from "./travel-protocol.ts";
export type BuildTravelCandidateHeadersOptions = Omit<
  BuildTravelCandidateHeadersOptionsProtocol,
  "requestId"
> & { requestId?: string };
export const buildTravelCandidateHeaders = (
  options: Omit<BuildTravelCandidateHeadersOptions, "requestId"> & { requestId?: string },
) =>
  buildTravelCandidateHeadersProtocol({
    ...options,
    requestId: options.requestId ?? generateNinebotNonce(),
  });
import { generateNinebotNonce } from "./crypto-node.ts";
import { NinebotHttpError } from "./client.ts";
import {
  buildNinebotEncryptedRequestCandidate,
  decryptNinebotResponsePayloadCandidate,
  generateNinebotCandidateRequestMaterial,
} from "./crypto-codec.ts";
import type { NinebotCandidateKeyData } from "./crypto-codec.ts";
import {
  parseNinebotEncryptedResponse,
  serializeNinebotEncryptedRequest,
} from "./crypto-envelope.ts";
import type {
  NinebotEncryptedRequestEnvelope,
  NinebotEncryptedResponseEnvelope,
} from "./crypto-envelope.ts";
import { ninebotCandidateRsaPublicKeyPem } from "./rsa-node.ts";
import { ninebotVehicleCandidateProtocol } from "./vehicle-node.ts";
import type { NinebotResponse, NinebotTransport } from "./transport.ts";

export interface BuildTravelDetailEncryptedRequestCandidateOptions {
  fields: TravelDetailPlaintextFields;
  platform: number;
  p?: string;
  t?: string;
  timeStamp?: number;
  /** Defaults to the public key embedded in ninecli 0.1.7. */
  rsaPublicKey?: Uint8Array | string;
}

export interface TravelDetailEncryptedRequestCandidate {
  envelope: NinebotEncryptedRequestEnvelope;
  keyData: NinebotCandidateKeyData;
}

/** Builds a single-ride detail candidate and returns the response key context. */
export const buildTravelDetailEncryptedRequestCandidate = ({
  fields,
  platform,
  p = ninebotVehicleCandidateProtocol.p,
  t = ninebotVehicleCandidateProtocol.t,
  timeStamp,
  rsaPublicKey,
}: BuildTravelDetailEncryptedRequestCandidateOptions): TravelDetailEncryptedRequestCandidate => {
  const material = generateNinebotCandidateRequestMaterial(
    timeStamp === undefined ? { platform, p, t } : { platform, p, t, timeStamp },
  );
  return {
    envelope: buildNinebotEncryptedRequestCandidate({
      plaintextBody: buildTravelDetailPlaintextBody(fields),
      material,
      rsaPublicKey: rsaPublicKey ?? ninebotCandidateRsaPublicKeyPem,
    }),
    keyData: material.keyData,
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

/** Decrypts and parses one monthly travel response with its request-specific key context. */
export const decodeTravelMonthResponseCandidate = ({
  envelope,
  keyData,
}: {
  envelope: NinebotEncryptedResponseEnvelope;
  keyData: NinebotCandidateKeyData;
}) =>
  parseTravelMonthResponseCandidate(decryptNinebotResponsePayloadCandidate({ envelope, keyData }));

/** Decrypts and parses one single-ride detail response with its request-specific key context. */
export const decodeTravelDetailResponseCandidate = ({
  envelope,
  keyData,
}: {
  envelope: NinebotEncryptedResponseEnvelope;
  keyData: NinebotCandidateKeyData;
}) =>
  parseTravelDetailResponseCandidate(decryptNinebotResponsePayloadCandidate({ envelope, keyData }));

export interface CreateNinebotTravelCandidateClientOptions {
  transport: NinebotTransport;
  platform: number;
  p?: string;
  t?: string;
  timeStamp?: number;
  /** Defaults to the public key embedded in ninecli 0.1.7. */
  rsaPublicKey?: Uint8Array | string;
  /** Use `decodeGzipBody` in Node when the transport preserves content encoding. */
  responseBodyDecoder?: (response: NinebotResponse) => Uint8Array | Promise<Uint8Array>;
}

export interface ListTravelMonthCandidateOptions {
  fields: TravelMonthPlaintextFields;
  businessType: "1" | "2";
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

export interface GetTravelDetailCandidateOptions {
  fields: TravelDetailPlaintextFields;
  businessType: "1" | "2";
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

/** Creates a transport-backed Node client for the validated travel endpoints. */
export const createNinebotTravelCandidateClient = ({
  transport,
  platform,
  p = ninebotVehicleCandidateProtocol.p,
  t = ninebotVehicleCandidateProtocol.t,
  timeStamp,
  rsaPublicKey,
  responseBodyDecoder = (response) => response.body,
}: CreateNinebotTravelCandidateClientOptions) => {
  const send = async <T>(
    path: typeof travelMonthPath | typeof travelDetailPath,
    fields: TravelCandidateHeaderFields,
    businessType: "1" | "2",
    plaintextBody: Uint8Array,
    headers: Readonly<Record<string, string>> | undefined,
    signal: AbortSignal | undefined,
    decode: (payload: Uint8Array) => T,
  ) => {
    const material = generateNinebotCandidateRequestMaterial(
      timeStamp === undefined ? { platform, p, t } : { platform, p, t, timeStamp },
    );
    const envelope = buildNinebotEncryptedRequestCandidate({
      plaintextBody,
      material,
      rsaPublicKey: rsaPublicKey ?? ninebotCandidateRsaPublicKeyPem,
    });
    const response = await transport.send({
      service: "travel",
      method: "POST",
      path,
      headers: {
        ...buildTravelCandidateHeaders({ fields, businessType }),
        ...headers,
      },
      body: new TextEncoder().encode(serializeNinebotEncryptedRequest(envelope)),
      ...(signal === undefined ? {} : { signal }),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new NinebotHttpError(response.status);
    }
    const responseBody = await responseBodyDecoder(response);
    return decode(
      decryptNinebotResponsePayloadCandidate({
        envelope: parseNinebotEncryptedResponse(responseBody),
        keyData: material.keyData,
      }),
    );
  };

  return {
    month: (options: ListTravelMonthCandidateOptions) =>
      send(
        travelMonthPath,
        options.fields,
        options.businessType,
        buildTravelMonthPlaintextBody(options.fields),
        options.headers,
        options.signal,
        parseTravelMonthResponseCandidate,
      ),
    detail: (options: GetTravelDetailCandidateOptions) =>
      send(
        travelDetailPath,
        options.fields,
        options.businessType,
        buildTravelDetailPlaintextBody(options.fields),
        options.headers,
        options.signal,
        parseTravelDetailResponseCandidate,
      ),
  };
};
