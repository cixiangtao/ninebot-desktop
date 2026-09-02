import {
  parseNinebotEncryptedResponse,
  type NinebotEncryptedRequestEnvelope,
  type NinebotEncryptedResponseEnvelope,
} from "./crypto-envelope.ts";
import { buildVehicleListRequest, vehicleListPath, type VehicleServiceName } from "./vehicle.ts";
import type { NinebotRequest } from "./transport.ts";

export interface VehicleCodecRequestInput {
  service: VehicleServiceName;
  path: typeof vehicleListPath;
  headers: Readonly<Record<string, string>>;
  plaintextBody: Uint8Array;
}

export interface VehicleCodecRequestResult {
  envelope: NinebotEncryptedRequestEnvelope;
  /** Per-request material passed back to the matching response decoder. */
  responseContext?: unknown;
}

export interface VehicleCodecResponseInput {
  service: VehicleServiceName;
  path: typeof vehicleListPath;
  envelope: NinebotEncryptedResponseEnvelope;
  responseContext?: unknown;
}

/** Codec contract for the still-opaque vehicle request/response cryptography. */
export interface NinebotVehicleCodec {
  encodeRequest(
    input: VehicleCodecRequestInput,
  ): Promise<NinebotEncryptedRequestEnvelope | VehicleCodecRequestResult>;
  decodeResponse(input: VehicleCodecResponseInput): Promise<Uint8Array>;
}

export interface BuildVehicleListRequestWithCodecOptions {
  service: VehicleServiceName;
  plaintextBody: Uint8Array;
  headers?: Readonly<Record<string, string>>;
  codec: NinebotVehicleCodec;
}

export interface PreparedVehicleListRequest {
  request: NinebotRequest;
  responseContext?: unknown;
}

const normalizeCodecRequestResult = (
  result: NinebotEncryptedRequestEnvelope | VehicleCodecRequestResult,
): VehicleCodecRequestResult => ("envelope" in result ? result : { envelope: result });

/** Builds a request and preserves the codec context needed for its response. */
export const prepareVehicleListRequestWithCodec = async ({
  service,
  plaintextBody,
  headers = {},
  codec,
}: BuildVehicleListRequestWithCodecOptions): Promise<PreparedVehicleListRequest> => {
  const encoded = normalizeCodecRequestResult(
    await codec.encodeRequest({
      service,
      path: vehicleListPath,
      headers,
      plaintextBody: plaintextBody.slice(),
    }),
  );
  return {
    request: buildVehicleListRequest({ service, envelope: encoded.envelope, headers }),
    responseContext: encoded.responseContext,
  };
};

/** Runs a codec and builds the transport request without exposing ciphertext details. */
export const buildVehicleListRequestWithCodec = async ({
  service,
  plaintextBody,
  headers = {},
  codec,
}: BuildVehicleListRequestWithCodecOptions): Promise<NinebotRequest> => {
  const prepared = await prepareVehicleListRequestWithCodec({
    service,
    plaintextBody,
    headers,
    codec,
  });
  return prepared.request;
};

export interface DecodeVehicleListResponseWithCodecOptions {
  service: VehicleServiceName;
  responseBody: Uint8Array | string;
  codec: NinebotVehicleCodec;
  responseContext?: unknown;
}

/** Parses a decompressed response envelope and delegates opaque bytes to the codec. */
export const decodeVehicleListResponseWithCodec = async ({
  service,
  responseBody,
  codec,
  responseContext,
}: DecodeVehicleListResponseWithCodecOptions) =>
  codec.decodeResponse({
    service,
    path: vehicleListPath,
    envelope: parseNinebotEncryptedResponse(responseBody),
    responseContext,
  });
