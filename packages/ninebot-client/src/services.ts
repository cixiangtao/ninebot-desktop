import { NinebotHttpError } from "./client.ts";
import {
  parseNinebotEncryptedResponse,
  serializeNinebotEncryptedRequest,
} from "./crypto-envelope.ts";
import {
  buildBusinessLoginHeaders,
  buildBusinessLoginPlaintextBody,
  businessLoginPath,
  parseBusinessLoginResponseCandidate,
  type BusinessLoginPlaintextFields,
} from "./business-login-protocol.ts";
import {
  buildVehicleListCandidateHeaders,
  buildVehicleListPlaintextBody,
  parseVehicleListResponseCandidate,
} from "./vehicle-protocol.ts";
import { vehicleListPath } from "./vehicle.ts";
import {
  buildTravelCandidateHeaders,
  buildTravelDetailPlaintextBody,
  buildTravelMonthPlaintextBody,
  parseTravelDetailResponseCandidate,
  parseTravelMonthResponseCandidate,
  travelDetailPath,
  travelMonthPath,
} from "./travel-protocol.ts";
import {
  buildTelemetryCandidateHeaders,
  buildVehicleBatteryPlaintextBody,
  buildVehicleStatusPlaintextBody,
  parseVehicleBatteryResponseCandidate,
  parseVehicleStatusResponseCandidate,
  vehicleBatteryPath,
  vehicleStatusPath,
} from "./telemetry-protocol.ts";
import type { NinebotCandidateSessionClients } from "./candidate-session-core.ts";
import type { NinebotCryptoAdapter, NinebotResponseBodyDecoder } from "./platform.ts";
import type { NinebotRequest, NinebotTransport } from "./transport.ts";

export interface NinebotServiceClientsOptions {
  transport: NinebotTransport;
  crypto: NinebotCryptoAdapter;
  responseBodyDecoder?: NinebotResponseBodyDecoder;
}

const assertActive = (signal?: AbortSignal) => {
  if (signal?.aborted) throw signal.reason ?? new Error("Ninebot request was cancelled");
};

/** Shared encrypted HTTP pipeline; each request retains its own response decoder. */
export const createNinebotServiceClients = ({
  transport,
  crypto,
  responseBodyDecoder = (response) => response.body,
}: NinebotServiceClientsOptions) => {
  const send = async (request: Omit<NinebotRequest, "method" | "body">, plaintext: Uint8Array) => {
    assertActive(request.signal);
    const encoded = await crypto.encode(plaintext);
    assertActive(request.signal);
    const response = await transport.send({
      ...request,
      method: "POST",
      body: new TextEncoder().encode(serializeNinebotEncryptedRequest(encoded.envelope)),
    });
    assertActive(request.signal);
    if (response.status < 200 || response.status >= 300)
      throw new NinebotHttpError(response.status);
    const body = await responseBodyDecoder(response);
    assertActive(request.signal);
    const payload = await encoded.decode(parseNinebotEncryptedResponse(body));
    assertActive(request.signal);
    return payload;
  };
  const requestId = (headers?: Readonly<Record<string, string>>) =>
    headers?.["request-id"] ?? crypto.nonce();
  const clients: NinebotCandidateSessionClients = {
    vehicles: {
      async list({ service, fields, headers, signal }) {
        return parseVehicleListResponseCandidate(
          await send(
            {
              service,
              path: vehicleListPath,
              headers: {
                "accept-encoding": "gzip",
                "content-type": "text/html;charset=UTF-8",
                need_decrypt: "1",
                "ninebot-version": "2",
                ...buildVehicleListCandidateHeaders({
                  service,
                  fields,
                  requestId: requestId(headers),
                }),
                ...headers,
              },
              ...(signal === undefined ? {} : { signal }),
            },
            buildVehicleListPlaintextBody(fields),
          ),
        );
      },
    },
    telemetry: {
      async status({ service, fields, headers, signal }) {
        return parseVehicleStatusResponseCandidate(
          await send(
            {
              service,
              path: vehicleStatusPath,
              headers: {
                ...buildTelemetryCandidateHeaders({
                  service,
                  fields,
                  requestId: requestId(headers),
                }),
                ...headers,
              },
              ...(signal === undefined ? {} : { signal }),
            },
            buildVehicleStatusPlaintextBody(fields),
          ),
        );
      },
      async battery({ service, fields, headers, signal }) {
        return parseVehicleBatteryResponseCandidate(
          await send(
            {
              service,
              path: vehicleBatteryPath,
              headers: {
                ...buildTelemetryCandidateHeaders({
                  service,
                  fields,
                  requestId: requestId(headers),
                }),
                ...headers,
              },
              ...(signal === undefined ? {} : { signal }),
            },
            buildVehicleBatteryPlaintextBody(fields),
          ),
        );
      },
    },
    travel: {
      async month({ fields, businessType, headers, signal }) {
        return parseTravelMonthResponseCandidate(
          await send(
            {
              service: "travel",
              path: travelMonthPath,
              headers: {
                ...buildTravelCandidateHeaders({
                  fields,
                  businessType,
                  requestId: requestId(headers),
                }),
                ...headers,
              },
              ...(signal === undefined ? {} : { signal }),
            },
            buildTravelMonthPlaintextBody(fields),
          ),
        );
      },
      async detail({ fields, businessType, headers, signal }) {
        return parseTravelDetailResponseCandidate(
          await send(
            {
              service: "travel",
              path: travelDetailPath,
              headers: {
                ...buildTravelCandidateHeaders({
                  fields,
                  businessType,
                  requestId: requestId(headers),
                }),
                ...headers,
              },
              ...(signal === undefined ? {} : { signal }),
            },
            buildTravelDetailPlaintextBody(fields),
          ),
        );
      },
    },
  };
  return {
    ...clients,
    business: {
      async login(fields: BusinessLoginPlaintextFields) {
        return parseBusinessLoginResponseCandidate(
          await send(
            {
              service: "business",
              path: businessLoginPath,
              headers: buildBusinessLoginHeaders({ fields, requestId: crypto.nonce() }),
            },
            buildBusinessLoginPlaintextBody(fields),
          ),
        );
      },
    },
  };
};
