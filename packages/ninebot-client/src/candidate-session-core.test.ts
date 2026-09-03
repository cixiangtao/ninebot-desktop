import { describe, expect, it } from "vitest";
import {
  createNinebotCandidateSessionClientFromClients,
  type NinebotCandidateSessionClients,
  type NinebotCandidateSessionFields,
} from "./candidate-session-core.ts";

const session: NinebotCandidateSessionFields = {
  sys_language: "zh-hans-cn",
  client_ver: "610063322",
  device_id: "device-id",
  regionx: "bj",
  language: "zh",
  ostype: "and",
  lang: "zh",
  platform_ver: "13 device",
  platform: "android",
  login_country: "CN",
  access_token: "token",
  uid: "12345678",
};

describe("platform-neutral candidate session core", () => {
  it("assembles fields and routes each operation through injected clients", async () => {
    const calls: Array<{
      kind: string;
      fields: unknown;
      headers?: Readonly<Record<string, string>>;
    }> = [];
    const clients = {
      vehicles: {
        list: async ({
          fields,
          headers,
        }: {
          fields: unknown;
          headers?: Readonly<Record<string, string>>;
        }) => {
          calls.push({ kind: "vehicles", fields, ...(headers ? { headers } : {}) });
          return { code: 1, data: [], desc: null, time_cost: 1, extra: null };
        },
      },
      telemetry: {
        status: async ({
          fields,
          headers,
        }: {
          fields: unknown;
          headers?: Readonly<Record<string, string>>;
        }) => {
          calls.push({ kind: "status", fields, ...(headers ? { headers } : {}) });
          return { code: 1, data: [], desc: null, time_cost: 1, extra: null };
        },
        battery: async ({
          fields,
          headers,
        }: {
          fields: unknown;
          headers?: Readonly<Record<string, string>>;
        }) => {
          calls.push({ kind: "battery", fields, ...(headers ? { headers } : {}) });
          return { code: 1, data: {}, desc: null, time_cost: 1, extra: null };
        },
      },
      travel: {
        month: async ({
          fields,
          headers,
        }: {
          fields: unknown;
          headers?: Readonly<Record<string, string>>;
        }) => {
          calls.push({ kind: "month", fields, ...(headers ? { headers } : {}) });
          return {
            code: 1,
            detail: [],
            desc: null,
            duration: 0,
            ec: 0,
            first_time: null,
            list: [],
            month: "202608",
            times: 0,
            total_mileages: 0,
          };
        },
        detail: async ({
          fields,
          headers,
        }: {
          fields: unknown;
          headers?: Readonly<Record<string, string>>;
        }) => {
          calls.push({ kind: "detail", fields, ...(headers ? { headers } : {}) });
          return { code: 1, desc: null, trail: "" };
        },
      },
    } satisfies NinebotCandidateSessionClients;
    const client = createNinebotCandidateSessionClientFromClients({
      session,
      clients,
      clock: () => 1_725_000_000_000,
      nonceFactory: () => "0123456789abcdef0123456789abcdef",
      requestIdFactory: () => "fedcba9876543210fedcba9876543210",
    });

    await client.listVehicles({ service: "ebike", vehicleType: 14363, headers: { "x-test": "1" } });
    await client.status({ service: "motor", serialNumber: "SN1234567890" });
    await client.battery({ service: "ebike", serialNumber: "SN1234567890" });
    await client.month({
      service: "motor",
      serialNumber: "SN1234567890",
      vehicleType: 14363,
      month: "202608",
    });
    await client.detail({
      service: "ebike",
      serialNumber: "SN1234567890",
      vehicleType: 14363,
      travelId: "travel-12345678901234567890",
    });

    expect(calls.map(({ kind }) => kind)).toEqual([
      "vehicles",
      "status",
      "battery",
      "month",
      "detail",
    ]);
    expect(calls[0]).toMatchObject({
      fields: {
        vehicle_type: "14363",
        serviceTime: 1_725_000_000_000,
        nonce: "0123456789abcdef0123456789abcdef",
      },
      headers: { "request-id": "fedcba9876543210fedcba9876543210", "x-test": "1" },
    });
    expect(calls[1]?.fields).toMatchObject({
      sn_str: "SN1234567890",
      serviceTime: 1_725_000_000_000,
    });
    expect(calls[3]?.fields).toMatchObject({
      wnumber: "SN1234567890",
      vehicle_type: "14363",
      month: "202608",
      page: "1",
      rnVersion: "743",
      current_version: "610063322",
    });
  });

  it("does not require Node crypto when nonce and service clients are injected", async () => {
    let signal: AbortSignal | undefined;
    const client = createNinebotCandidateSessionClientFromClients({
      session,
      clients: {
        vehicles: {
          list: async (options) => ({
            code: 1,
            data: [options.fields],
            desc: null,
            time_cost: 0,
            extra: null,
          }),
        },
        telemetry: {
          status: async (options) => {
            signal = options.signal;
            return { code: 1, data: [], desc: null, time_cost: 0, extra: null };
          },
          battery: async () => ({ code: 1, data: {}, desc: null, time_cost: 0, extra: null }),
        },
        travel: {
          month: async () => ({
            code: 1,
            detail: [],
            desc: null,
            duration: 0,
            ec: 0,
            first_time: null,
            list: [],
            month: "202608",
            times: 0,
            total_mileages: 0,
          }),
          detail: async () => ({ code: 1, desc: null, trail: "" }),
        },
      } satisfies NinebotCandidateSessionClients,
      nonceFactory: () => "0123456789abcdef0123456789abcdef",
    });

    await client.status({ service: "ebike", serialNumber: "SN1234567890" });
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(false);
  });
});
