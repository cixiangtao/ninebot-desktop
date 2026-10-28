import { parseBusinessLoginResponseCandidate } from "./business-login-protocol.ts";
import {
  type NinebotBusinessLoginResponseCandidate,
  businessLoginProtocol,
  type BusinessLoginPlaintextFields,
  buildBusinessLoginPlaintextBody,
  type BuildBusinessLoginHeadersOptions as BuildBusinessLoginHeadersOptionsProtocol,
  buildBusinessLoginHeaders as buildBusinessLoginHeadersProtocol,
  buildBusinessLoginRequest,
} from "./business-login-protocol.ts";
export {
  type NinebotBusinessLoginResponseCandidate,
  businessLoginPath,
  businessLoginProtocol,
  type BusinessLoginPlaintextFields,
  buildBusinessLoginPlaintextBody,
  buildBusinessLoginRequest,
} from "./business-login-protocol.ts";
export type BuildBusinessLoginHeadersOptions = Omit<
  BuildBusinessLoginHeadersOptionsProtocol,
  "requestId"
> & { requestId?: string };
export const buildBusinessLoginHeaders = (
  options: Omit<BuildBusinessLoginHeadersOptions, "requestId"> & { requestId?: string },
) =>
  buildBusinessLoginHeadersProtocol({
    ...options,
    requestId: options.requestId ?? generateNinebotNonce(),
  });
import { generateNinebotNonce } from "./crypto-node.ts";
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
import type { NinebotResponse, NinebotTransport } from "./transport.ts";
import { NinebotHttpError } from "./client.ts";
import { decodeGzipBody } from "./response-node.ts";

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
}): NinebotBusinessLoginResponseCandidate<T> =>
  parseBusinessLoginResponseCandidate<T>(
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
    if (response.status < 200 || response.status >= 300) {
      throw new NinebotHttpError(response.status);
    }
    return decodeBusinessLoginResponse<T>({
      responseBody: decodeGzipBody(response),
      keyData: encoded.keyData,
    });
  },
});

export type BusinessLoginKeyData = ReturnType<typeof readKeyData>;
