import {
  buildTelemetryCandidateHeaders as buildTelemetryCandidateHeadersProtocol,
  type BuildTelemetryCandidateHeadersOptions as BuildTelemetryCandidateHeadersOptionsProtocol,
} from "./telemetry-protocol.ts";
export type BuildTelemetryCandidateHeadersOptions = Omit<
  BuildTelemetryCandidateHeadersOptionsProtocol,
  "requestId"
> & { requestId?: string };
export const buildTelemetryCandidateHeaders = (options: BuildTelemetryCandidateHeadersOptions) =>
  buildTelemetryCandidateHeadersProtocol({
    ...options,
    requestId: options.requestId ?? generateNinebotNonce(),
  });
import {
  vehicleStatusPath,
  vehicleBatteryPath,
  type TelemetryCandidateHeaderFields,
  type VehicleStatusPlaintextFields,
  type VehicleBatteryPlaintextFields,
  type TelemetryCandidateSessionFields,
  type BuildVehicleStatusFieldsOptions,
  type BuildVehicleBatteryFieldsOptions,
  buildVehicleStatusPlaintextBody,
  buildVehicleBatteryPlaintextBody,
  type TelemetryResponseCandidate,
  type VehicleStatusCandidateRecord,
  type VehicleBatteryCandidateRecord,
  parseTelemetryResponseCandidate,
  parseVehicleStatusResponseCandidate,
  parseVehicleBatteryResponseCandidate,
} from "./telemetry-protocol.ts";
export {
  vehicleStatusPath,
  vehicleBatteryPath,
  type TelemetryCandidateHeaderFields,
  type VehicleStatusPlaintextFields,
  type VehicleBatteryPlaintextFields,
  type TelemetryCandidateSessionFields,
  type BuildVehicleStatusFieldsOptions,
  type BuildVehicleBatteryFieldsOptions,
  buildVehicleStatusPlaintextBody,
  buildVehicleBatteryPlaintextBody,
  type TelemetryResponseCandidate,
  type NinebotTelemetryDataKind,
  NinebotTelemetryBusinessError,
  type VehicleStatusLocationCandidate,
  type VehicleStatusCandidateRecord,
  type VehicleBatteryPackCandidate,
  type VehicleBatteryCandidateRecord,
  parseTelemetryResponseCandidate,
  parseVehicleStatusResponseCandidate,
  parseVehicleBatteryResponseCandidate,
} from "./telemetry-protocol.ts";

import { NinebotHttpError } from "./client.ts";
import { generateNinebotNonce } from "./crypto-node.ts";
import {
  buildNinebotEncryptedRequestCandidate,
  decryptNinebotResponsePayloadCandidate,
  generateNinebotCandidateRequestMaterial,
} from "./crypto-codec.ts";
import type { NinebotCandidateKeyData } from "./crypto-codec.ts";
import {
  parseNinebotEncryptedResponse,
  serializeNinebotEncryptedRequest,
  type NinebotEncryptedRequestEnvelope,
  type NinebotEncryptedResponseEnvelope,
} from "./crypto-envelope.ts";
import { ninebotCandidateRsaPublicKeyPem } from "./rsa-node.ts";
import type { NinebotResponse, NinebotTransport } from "./transport.ts";

export interface BuildTelemetryEncryptedRequestCandidateOptions {
  plaintextBody: Uint8Array;
  platform: number;
  p?: string;
  t?: string;
  timeStamp?: number;
  /** Defaults to the public key embedded in ninecli 0.1.7. */
  rsaPublicKey?: Uint8Array | string;
}

const buildTelemetryEncryptedRequestCandidate = ({
  plaintextBody,
  platform,
  p = "101",
  t = "0",
  timeStamp,
  rsaPublicKey,
}: BuildTelemetryEncryptedRequestCandidateOptions) => {
  const material = generateNinebotCandidateRequestMaterial(
    timeStamp === undefined ? { platform, p, t } : { platform, p, t, timeStamp },
  );
  return {
    envelope: buildNinebotEncryptedRequestCandidate({
      plaintextBody,
      material,
      rsaPublicKey: rsaPublicKey ?? ninebotCandidateRsaPublicKeyPem,
    }),
    keyData: material.keyData,
  };
};

export interface VehicleTelemetryEncryptedRequestCandidate {
  envelope: NinebotEncryptedRequestEnvelope;
  keyData: NinebotCandidateKeyData;
}

/** Builds a status request candidate and returns its response key context. */
export const buildVehicleStatusEncryptedRequestCandidate = ({
  fields,
  ...options
}: BuildTelemetryEncryptedRequestCandidateOptions & { fields: VehicleStatusPlaintextFields }) =>
  buildTelemetryEncryptedRequestCandidate({
    ...options,
    plaintextBody: buildVehicleStatusPlaintextBody(fields),
  });

/** Builds a battery request candidate and returns its response key context. */
export const buildVehicleBatteryEncryptedRequestCandidate = ({
  fields,
  ...options
}: BuildTelemetryEncryptedRequestCandidateOptions & { fields: VehicleBatteryPlaintextFields }) =>
  buildTelemetryEncryptedRequestCandidate({
    ...options,
    plaintextBody: buildVehicleBatteryPlaintextBody(fields),
  });

/** Decrypts and parses a status response with its per-request key context. */
export const decodeVehicleStatusResponseCandidate = ({
  envelope,
  keyData,
}: {
  envelope: NinebotEncryptedResponseEnvelope;
  keyData: NinebotCandidateKeyData;
}) =>
  parseVehicleStatusResponseCandidate(
    decryptNinebotResponsePayloadCandidate({ envelope, keyData }),
  );

/** Decrypts and parses a battery response with its per-request key context. */
export const decodeVehicleBatteryResponseCandidate = ({
  envelope,
  keyData,
}: {
  envelope: NinebotEncryptedResponseEnvelope;
  keyData: NinebotCandidateKeyData;
}) =>
  parseVehicleBatteryResponseCandidate(
    decryptNinebotResponsePayloadCandidate({ envelope, keyData }),
  );

/** Decrypts one telemetry response while retaining its business wrapper metadata. */
export const decodeTelemetryResponseCandidate = ({
  envelope,
  keyData,
}: {
  envelope: NinebotEncryptedResponseEnvelope;
  keyData: NinebotCandidateKeyData;
}) =>
  parseTelemetryResponseCandidate(decryptNinebotResponsePayloadCandidate({ envelope, keyData }));

export interface CreateNinebotTelemetryCandidateClientOptions {
  transport: NinebotTransport;
  platform: number;
  p?: string;
  t?: string;
  timeStamp?: number;
  /** Defaults to the public key embedded in ninecli 0.1.7. */
  rsaPublicKey?: Uint8Array | string;
  responseBodyDecoder?: (response: NinebotResponse) => Uint8Array | Promise<Uint8Array>;
}

interface VehicleTelemetryCandidateOptionsBase {
  service: "ebike" | "motor";
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

export interface VehicleStatusCandidateOptions extends VehicleTelemetryCandidateOptionsBase {
  fields: VehicleStatusPlaintextFields;
}

export interface VehicleBatteryCandidateOptions extends VehicleTelemetryCandidateOptionsBase {
  fields: VehicleBatteryPlaintextFields;
}

/** Creates a transport-backed Node client for status and battery candidates. */
export const createNinebotTelemetryCandidateClient = ({
  transport,
  platform,
  p = "101",
  t = "0",
  timeStamp,
  rsaPublicKey,
  responseBodyDecoder = (response) => response.body,
}: CreateNinebotTelemetryCandidateClientOptions) => {
  const send = async <TData>(
    service: "ebike" | "motor",
    path: typeof vehicleStatusPath | typeof vehicleBatteryPath,
    fields: TelemetryCandidateHeaderFields,
    plaintextBody: Uint8Array,
    headers: Readonly<Record<string, string>> | undefined,
    signal: AbortSignal | undefined,
    decode: (plaintext: Uint8Array) => TelemetryResponseCandidate<TData>,
  ): Promise<TelemetryResponseCandidate<TData>> => {
    const material = generateNinebotCandidateRequestMaterial(
      timeStamp === undefined ? { platform, p, t } : { platform, p, t, timeStamp },
    );
    const envelope = buildNinebotEncryptedRequestCandidate({
      plaintextBody,
      material,
      rsaPublicKey: rsaPublicKey ?? ninebotCandidateRsaPublicKeyPem,
    });
    const response = await transport.send({
      service,
      method: "POST",
      path,
      headers: {
        ...buildTelemetryCandidateHeaders({ service, fields }),
        ...headers,
      },
      body: new TextEncoder().encode(serializeNinebotEncryptedRequest(envelope)),
      ...(signal === undefined ? {} : { signal }),
    });
    if (response.status < 200 || response.status >= 300)
      throw new NinebotHttpError(response.status);
    const responseBody = await responseBodyDecoder(response);
    return decode(
      decryptNinebotResponsePayloadCandidate({
        envelope: parseNinebotEncryptedResponse(responseBody),
        keyData: material.keyData,
      }),
    );
  };
  return {
    status: (options: VehicleStatusCandidateOptions) =>
      send<VehicleStatusCandidateRecord[]>(
        options.service,
        vehicleStatusPath,
        options.fields,
        buildVehicleStatusPlaintextBody(options.fields),
        options.headers,
        options.signal,
        parseVehicleStatusResponseCandidate,
      ),
    battery: (options: VehicleBatteryCandidateOptions) =>
      send<VehicleBatteryCandidateRecord>(
        options.service,
        vehicleBatteryPath,
        options.fields,
        buildVehicleBatteryPlaintextBody(options.fields),
        options.headers,
        options.signal,
        parseVehicleBatteryResponseCandidate,
      ),
  };
};

const buildTelemetryHeaderFields = ({
  session,
  serviceTime = Date.now(),
  nonce = generateNinebotNonce(),
}: {
  session: TelemetryCandidateSessionFields;
  serviceTime?: number;
  nonce?: string;
}): TelemetryCandidateHeaderFields => ({ ...session, serviceTime, nonce });

/** Builds validated status fields with a millisecond `serviceTime`. */
export const buildVehicleStatusFields = ({
  session,
  sn_str,
  serviceTime,
  nonce,
}: BuildVehicleStatusFieldsOptions): VehicleStatusPlaintextFields => ({
  ...buildTelemetryHeaderFields({
    session,
    ...(serviceTime === undefined ? {} : { serviceTime }),
    ...(nonce === undefined ? {} : { nonce }),
  }),
  sn_str,
});

/** Builds validated battery fields with a millisecond `serviceTime`. */
export const buildVehicleBatteryFields = ({
  session,
  wnumber,
  serviceTime,
  nonce,
}: BuildVehicleBatteryFieldsOptions): VehicleBatteryPlaintextFields => ({
  ...buildTelemetryHeaderFields({
    session,
    ...(serviceTime === undefined ? {} : { serviceTime }),
    ...(nonce === undefined ? {} : { nonce }),
  }),
  wnumber,
});
