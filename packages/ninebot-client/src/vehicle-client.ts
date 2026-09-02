import { NinebotHttpError } from "./client.ts";
import {
  prepareVehicleListRequestWithCodec,
  decodeVehicleListResponseWithCodec,
  type NinebotVehicleCodec,
} from "./vehicle-codec.ts";
import type { VehicleServiceName } from "./vehicle.ts";
import type { NinebotResponse, NinebotTransport } from "./transport.ts";

export interface NinebotVehicleClientOptions {
  transport: NinebotTransport;
  codec: NinebotVehicleCodec;
  responseBodyDecoder?: (response: NinebotResponse) => Uint8Array | Promise<Uint8Array>;
}

export interface ListVehiclesOptions {
  service: VehicleServiceName;
  plaintextBody: Uint8Array;
  headers?: Readonly<Record<string, string>>;
}

/** High-level vehicle-list facade; the codec remains responsible for all cryptography. */
export const createNinebotVehicleClient = ({
  transport,
  codec,
  responseBodyDecoder = (response) => response.body,
}: NinebotVehicleClientOptions) => ({
  async list({ service, plaintextBody, headers = {} }: ListVehiclesOptions) {
    const prepared = await prepareVehicleListRequestWithCodec({
      service,
      plaintextBody,
      headers,
      codec,
    });
    const response = await transport.send(prepared.request);
    if (response.status < 200 || response.status >= 300) {
      throw new NinebotHttpError(response.status);
    }
    const body = await responseBodyDecoder(response);
    return decodeVehicleListResponseWithCodec({
      service,
      responseBody: body,
      codec,
      responseContext: prepared.responseContext,
    });
  },
});

export type NinebotVehicleClient = ReturnType<typeof createNinebotVehicleClient>;
