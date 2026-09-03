import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildTelemetryCandidateHeaders,
  buildVehicleBatteryFields,
  buildVehicleBatteryPlaintextBody,
  buildVehicleStatusFields,
  buildVehicleStatusPlaintextBody,
  createNinebotTelemetryCandidateClient,
  decodeVehicleBatteryResponseCandidate,
  decodeVehicleStatusResponseCandidate,
  parseTelemetryResponseCandidate,
  parseVehicleBatteryResponseCandidate,
  parseVehicleStatusResponseCandidate,
  vehicleBatteryPath,
  vehicleStatusPath,
} from "./telemetry-node.ts";
import {
  decodeNinebotBase64,
  decryptAesCbcPkcs7,
  deriveNinebotKeyCandidate,
  encodeNinebotBase64,
  encryptAesCbcPkcs7,
} from "./crypto-node.ts";
import { parseNinebotEncryptedRequest } from "./crypto-envelope.ts";

const common = {
  sys_language: "zh-hans-cn",
  client_ver: "610063322",
  device_id: "device-id",
  regionx: "bj",
  language: "zh",
  ostype: "and",
  lang: "zh",
  platform_ver: "13 Xiaomi",
  platform: "android",
  login_country: "CN",
  access_token: "token",
  uid: "12345678",
  serviceTime: 1_725_000_000,
  nonce: "0123456789abcdef0123456789abcdef",
} as const;

const statusFields = { ...common, sn_str: "SN1234567890" } as const;
const batteryFields = { ...common, wnumber: "SN1234567890" } as const;
const sessionFields = { ...common } as Omit<typeof common, "serviceTime" | "nonce">;

describe("Node telemetry candidate", () => {
  it("builds ordered status and battery bodies with uppercase checkcodes", () => {
    const status = new TextDecoder().decode(buildVehicleStatusPlaintextBody(statusFields));
    const battery = new TextDecoder().decode(buildVehicleBatteryPlaintextBody(batteryFields));
    expect(status).toContain('"uid":"12345678","sn_str":"SN1234567890","serviceTime":1725000000');
    expect(battery).toContain('"uid":"12345678","wnumber":"SN1234567890","serviceTime":1725000000');
    expect(status).toMatch(/,"checkcode":"[0-9A-F]{32}"}$/);
    expect(battery).toMatch(/,"checkcode":"[0-9A-F]{32}"}$/);
  });

  it("builds both request field shapes from shared session metadata", () => {
    expect(
      buildVehicleStatusFields({
        session: sessionFields,
        sn_str: "SN1234567890",
        serviceTime: 1_725_000_000,
        nonce: common.nonce,
      }),
    ).toEqual(statusFields);
    expect(
      buildVehicleBatteryFields({
        session: sessionFields,
        wnumber: "SN1234567890",
        serviceTime: 1_725_000_000,
        nonce: common.nonce,
      }),
    ).toEqual(batteryFields);
  });

  it("maps observed telemetry headers and service business type", () => {
    expect(
      buildTelemetryCandidateHeaders({
        service: "motor",
        fields: statusFields,
        requestId: "ABCDEF0123456789ABCDEF0123456789",
        serviceTime: 1_725_000_001,
      }),
    ).toMatchObject({
      "business-type": "1",
      "client-ver": "610063322",
      "device-id": "device-id",
      platform: "Android",
      "platform-ver": "13",
      "request-id": "ABCDEF0123456789ABCDEF0123456789",
      "service-time": "1725000001",
      uid: "12345678",
    });
  });

  it("parses the shared business wrapper for array or object data", () => {
    expect(
      parseTelemetryResponseCandidate(
        new TextEncoder().encode(
          JSON.stringify({
            code: 1,
            data: [{ speed: 53 }],
            desc: "ok",
            time_cost: 4,
            extra: { sn: "SN" },
          }),
        ),
      ),
    ).toEqual({ code: 1, data: [{ speed: 53 }], desc: "ok", time_cost: 4, extra: { sn: "SN" } });
    expect(
      parseTelemetryResponseCandidate(
        new TextEncoder().encode(
          JSON.stringify({ code: 1, data: { battery: 80 }, desc: "ok", time_cost: 4 }),
        ),
      ),
    ).toMatchObject({ code: 1, data: { battery: 80 }, desc: "ok", extra: null });
  });

  it("rejects a malformed business description instead of silently erasing it", () => {
    expect(() =>
      parseTelemetryResponseCandidate(
        new TextEncoder().encode(JSON.stringify({ code: 1, data: [], desc: 200 })),
      ),
    ).toThrow("desc is invalid");
  });

  it("provides typed status and battery response parsers without dropping unknown fields", () => {
    const status = parseVehicleStatusResponseCandidate(
      new TextEncoder().encode(
        JSON.stringify({
          code: 1,
          data: [{ pwr: 1, loc: { lon: "116.3" }, firmware_only: "kept" }],
          desc: "ok",
          time_cost: 2,
        }),
      ),
    );
    expect(status.data[0]).toMatchObject({ pwr: 1, firmware_only: "kept" });

    const battery = parseVehicleBatteryResponseCandidate(
      new TextEncoder().encode(
        JSON.stringify({
          code: 1,
          data: { electricity: 74, battery_list: [{ electricity: "73" }], firmware_only: true },
          desc: "ok",
          time_cost: 2,
        }),
      ),
    );
    expect(battery.data).toMatchObject({ electricity: 74, firmware_only: true });
  });

  it("exports typed encrypted-response decoder entry points", () => {
    expect(decodeVehicleStatusResponseCandidate).toBeTypeOf("function");
    expect(decodeVehicleBatteryResponseCandidate).toBeTypeOf("function");
  });

  it("runs the status candidate through a complete local request/response loop", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const client = createNinebotTelemetryCandidateClient({
      platform: 2,
      p: "101",
      t: "0",
      timeStamp: 1_725_000_000,
      rsaPublicKey: publicKey.export({ type: "spki", format: "pem" }),
      transport: {
        async send(request) {
          expect(request.service).toBe("ebike");
          expect(request.path).toBe(vehicleStatusPath);
          const requestEnvelope = parseNinebotEncryptedRequest(request.body ?? new Uint8Array());
          const kReq = new Uint8Array(
            privateDecrypt(
              { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
              decodeNinebotBase64(requestEnvelope.k, "request k"),
            ),
          );
          const wrapper = JSON.parse(
            new TextDecoder().decode(
              decryptAesCbcPkcs7({
                ciphertext: decodeNinebotBase64(requestEnvelope.d, "request d"),
                key: kReq,
              }),
            ),
          ) as Record<string, string>;
          const responseKey = deriveNinebotKeyCandidate([
            new TextEncoder().encode(wrapper.keyDataOne),
            new TextEncoder().encode(wrapper.keyDataTwo),
            new TextEncoder().encode(wrapper.keyDataThree),
            new TextEncoder().encode(wrapper.keyDataFour),
          ]);
          const business = new TextEncoder().encode(
            JSON.stringify({
              code: 1,
              data: [{ speed: 53.2 }],
              desc: "ok",
              time_cost: 2,
              extra: { sn: "SN" },
            }),
          );
          const responsePlaintext = new TextEncoder().encode(
            JSON.stringify({ data: encodeNinebotBase64(business), timeStamp: 1_725_000_000 }),
          );
          return {
            status: 200,
            headers: {},
            body: new TextEncoder().encode(
              JSON.stringify({
                v: 101,
                s: encodeNinebotBase64(new Uint8Array(128)),
                r: encodeNinebotBase64(
                  encryptAesCbcPkcs7({ plaintext: responsePlaintext, key: responseKey }),
                ),
              }),
            ),
          };
        },
      },
    });

    await expect(client.status({ service: "ebike", fields: statusFields })).resolves.toMatchObject({
      code: 1,
      data: [{ speed: 53.2 }],
      desc: "ok",
    });
  });

  it("exposes the battery path as a separate candidate operation", () => {
    expect(vehicleBatteryPath).toBe("/v6/vehicle/battery-info");
    expect(buildVehicleBatteryPlaintextBody(batteryFields)).toBeInstanceOf(Uint8Array);
  });
});
