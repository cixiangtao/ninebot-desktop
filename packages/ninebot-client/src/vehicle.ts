import {
  serializeNinebotEncryptedRequest,
  type NinebotEncryptedRequestEnvelope,
} from "./crypto-envelope.ts";
import type { NinebotRequest } from "./transport.ts";

export const vehicleListPath = "/vehicle/binding/my-vehicle" as const;
export const vehicleServiceNames = ["ebike", "motor"] as const;
export type VehicleServiceName = (typeof vehicleServiceNames)[number];

export interface BuildVehicleListRequestOptions {
  service: VehicleServiceName;
  envelope: NinebotEncryptedRequestEnvelope;
  headers?: Readonly<Record<string, string>>;
}

/** Builds the observed encrypted vehicle-list request without interpreting its ciphertext. */
export const buildVehicleListRequest = ({
  service,
  envelope,
  headers = {},
}: BuildVehicleListRequestOptions): NinebotRequest => {
  const body = new TextEncoder().encode(serializeNinebotEncryptedRequest(envelope));
  return {
    service,
    method: "POST",
    path: vehicleListPath,
    headers: {
      "accept-encoding": "gzip",
      "content-type": "text/html;charset=UTF-8",
      need_decrypt: "1",
      "ninebot-version": "2",
      ...headers,
    },
    body,
  };
};
