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

export interface VehicleCodecResponseInput {
  service: VehicleServiceName;
  path: typeof vehicleListPath;
  envelope: NinebotEncryptedResponseEnvelope;
}

/** Codec contract for the still-opaque vehicle request/response cryptography. */
export interface NinebotVehicleCodec {
  encodeRequest(input: VehicleCodecRequestInput): Promise<NinebotEncryptedRequestEnvelope>;
  decodeResponse(input: VehicleCodecResponseInput): Promise<Uint8Array>;
}

export interface BuildVehicleListRequestWithCodecOptions {
  service: VehicleServiceName;
  plaintextBody: Uint8Array;
  headers?: Readonly<Record<string, string>>;
  codec: NinebotVehicleCodec;
}

/** Runs a codec and builds the transport request without exposing ciphertext details. */
export const buildVehicleListRequestWithCodec = async ({
  service,
  plaintextBody,
  headers = {},
  codec,
}: BuildVehicleListRequestWithCodecOptions): Promise<NinebotRequest> => {
  const envelope = await codec.encodeRequest({
    service,
    path: vehicleListPath,
    headers,
    plaintextBody: plaintextBody.slice(),
  });
  return buildVehicleListRequest({ service, envelope, headers });
};

export interface DecodeVehicleListResponseWithCodecOptions {
  service: VehicleServiceName;
  responseBody: Uint8Array | string;
  codec: NinebotVehicleCodec;
}

/** Parses a decompressed response envelope and delegates opaque bytes to the codec. */
export const decodeVehicleListResponseWithCodec = async ({
  service,
  responseBody,
  codec,
}: DecodeVehicleListResponseWithCodecOptions) =>
  codec.decodeResponse({
    service,
    path: vehicleListPath,
    envelope: parseNinebotEncryptedResponse(responseBody),
  });
