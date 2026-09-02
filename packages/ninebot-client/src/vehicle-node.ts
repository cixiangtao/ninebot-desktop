import { computeNinebotBodyCheckcode } from "./crypto-node.ts";

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
  if (!/^[0-9a-f]{32}$/.test(fields.nonce)) {
    throw new Error(
      "Ninebot vehicle request field nonce must be 32 lowercase hexadecimal characters",
    );
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
