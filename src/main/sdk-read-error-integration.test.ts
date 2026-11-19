import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryNinebotAuthSessionStore,
  NinebotAuthSessionManager,
  createNinebotTelemetryCandidateClient,
  buildVehicleStatusFields,
  buildVehicleBatteryFields,
  NinebotHttpError,
  NinebotTelemetryBusinessError,
} from "@jiuhao/ninebot-client/node";
import { createCandidateVehicleReader } from "./vehicle-source.js";
import { createCandidateTelemetryReader } from "./telemetry-source.js";
import { createCandidateTravelReader } from "./travel-source.js";
import { createSdkDesktopRuntime } from "./sdk-desktop-runtime.js";
import { registerIpcHandlers } from "./ipc.js";
import { ipcChannels, type BridgeResult } from "../shared/contracts.js";

const handlers = vi.hoisted(
  () => new Map<string, (...args: unknown[]) => Promise<BridgeResult<unknown>>>(),
);
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => Promise<BridgeResult<unknown>>) =>
      handlers.set(name, handler),
  },
  BrowserWindow: {},
  dialog: {},
}));
const directories: string[] = [];
afterEach(async () => {
  handlers.clear();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const invoke = (channel: string, input?: unknown) => handlers.get(channel)!(null, input);

// Real SDK request construction + HTTP error handling, entirely injected I/O.
const httpFailure = (status: number) =>
  createNinebotTelemetryCandidateClient({
    platform: 2,
    transport: { send: async () => ({ status, headers: {}, body: new Uint8Array() }) },
  });

const setup = async (empty = false) => {
  const directory = await mkdtemp(join(tmpdir(), "sdk-read-errors-"));
  directories.push(directory);
  const session = { accessToken: "synthetic-access", businessUid: "synthetic-uid" };
  const store = createMemoryNinebotAuthSessionStore(session);
  const auth = new NinebotAuthSessionManager({
    store,
    provider: {
      loginWithPassword: async () => session,
      requestSmsCode: async () => {
        throw new Error("Unexpected SMS request");
      },
      loginWithSmsCode: async () => {
        throw new Error("Unexpected SMS login");
      },
      refresh: async () => {
        throw new Error("Unexpected refresh");
      },
      whoami: async <T>() => ({ username: "synthetic" }) as T,
    },
  });
  await auth.restore();
  const state: { status?: Error; battery?: Error; month?: Error } = {};
  const sessionProvider = () => auth.ensureSession();
  const calls = { status: vi.fn(), battery: vi.fn() };
  const vehicleReader = createCandidateVehicleReader({
    configDirectory: directory,
    sessionProvider,
    candidateClientFactory: () => ({
      listVehicles: async ({ service }) => ({
        data:
          !empty && service === "ebike"
            ? [
                {
                  wnumber: "synthetic-sn",
                  business_line: "ebike",
                  vehicle_type: "67",
                  device_name: "Synthetic",
                },
              ]
            : [],
      }),
    }),
  });
  const telemetryReader = createCandidateTelemetryReader({
    configDirectory: directory,
    sessionProvider,
    candidateClientFactory: (fields) => ({
      status: async ({ service, serialNumber, signal }) => {
        calls.status();
        if (state.status instanceof NinebotHttpError)
          return httpFailure(state.status.status).status({
            service,
            fields: buildVehicleStatusFields({ session: fields, sn_str: serialNumber }),
            ...(signal ? { signal } : {}),
          });
        if (state.status) throw state.status;
        return { pwr: 1, dump_energy: "64", loc: { lock: 1 } };
      },
      battery: async ({ service, serialNumber, signal }) => {
        calls.battery();
        if (state.battery instanceof NinebotHttpError)
          return httpFailure(state.battery.status).battery({
            service,
            fields: buildVehicleBatteryFields({ session: fields, wnumber: serialNumber }),
            ...(signal ? { signal } : {}),
          });
        if (state.battery) throw state.battery;
        return { electricity: 72 };
      },
    }),
  });
  const travelReader = createCandidateTravelReader({
    configDirectory: directory,
    sessionProvider,
    candidateClientFactory: () => ({
      month: async () => {
        if (state.month) throw state.month;
        return {};
      },
      detail: async () => ({}),
    }),
  });
  const client = await createSdkDesktopRuntime({
    configDirectory: directory,
    auth,
    readers: { vehicleReader, telemetryReader, travelReader },
  });
  registerIpcHandlers(client);
  const vehicles = await invoke(ipcChannels.listVehicles);
  expect(vehicles).toMatchObject({ ok: true, data: empty ? [] : [{ id: "vehicle-1" }] });
  return { state, store, session, calls };
};

describe("real SDK readers → desktop client → IPC (synthetic only)", () => {
  it("reports connected with an empty vehicle list instead of a read error", async () => {
    const { calls } = await setup(true);
    expect(await invoke(ipcChannels.authStatus)).toMatchObject({
      ok: true,
      data: { connected: true },
    });
    expect(await invoke(ipcChannels.listVehicles)).toEqual({ ok: true, data: [] });
    expect(await invoke(ipcChannels.getVehicleSnapshot, { vehicleId: "vehicle-1" })).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    expect(calls.status).not.toHaveBeenCalled();
    expect(calls.battery).not.toHaveBeenCalled();
  });
  it.each(["status", "battery"] as const)(
    "keeps the other telemetry partition after %s HTTP503",
    async (domain) => {
      const { state } = await setup();
      state[domain] = new NinebotHttpError(503);
      expect(
        await invoke(ipcChannels.getVehicleSnapshot, { vehicleId: "vehicle-1" }),
      ).toMatchObject({
        ok: true,
        data: {
          availability: { status: domain !== "status", battery: domain !== "battery" },
          batteryPercent: domain === "status" ? 72 : 64,
        },
      });
    },
  );
  it("returns a bounded upstream error when both domains fail", async () => {
    const { state } = await setup();
    state.status = new NinebotHttpError(500);
    state.battery = new Error("synthetic-private request body");
    const result = await invoke(ipcChannels.getVehicleSnapshot, { vehicleId: "vehicle-1" });
    expect(result).toMatchObject({ ok: false, error: { code: "UPSTREAM_ERROR" } });
    expect(JSON.stringify(result)).not.toContain("synthetic-private");
  });
  it("HTTP401 rejects partial success, clears IDs/caches, and preserves local credentials", async () => {
    const { state, store, session, calls } = await setup();
    expect(await invoke(ipcChannels.getVehicleSnapshot, { vehicleId: "vehicle-1" })).toMatchObject({
      ok: true,
    });
    state.status = new NinebotHttpError(401);
    expect(
      await invoke(ipcChannels.getVehicleSnapshot, { vehicleId: "vehicle-1", refresh: true }),
    ).toMatchObject({ ok: false, error: { code: "AUTH_REQUIRED" } });
    delete state.status;
    expect(await invoke(ipcChannels.getVehicleSnapshot, { vehicleId: "vehicle-1" })).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
    await invoke(ipcChannels.listVehicles);
    calls.status.mockClear();
    expect(await invoke(ipcChannels.getVehicleSnapshot, { vehicleId: "vehicle-1" })).toMatchObject({
      ok: true,
    });
    expect(calls.status).toHaveBeenCalledOnce();
    await expect(store.load()).resolves.toEqual(session);
  });
  it.each(["forbidden", "business-code"] as const)(
    "does not clear IDs or credentials for %s",
    async (kind) => {
      const { state, store, session } = await setup();
      state.status =
        kind === "forbidden"
          ? new NinebotHttpError(403)
          : new NinebotTelemetryBusinessError("synthetic-private", {
              code: 401,
              data: null,
              desc: "synthetic-private",
              time_cost: null,
              extra: null,
            });
      expect(
        await invoke(ipcChannels.getVehicleSnapshot, { vehicleId: "vehicle-1" }),
      ).toMatchObject({ ok: true, data: { availability: { status: false, battery: true } } });
      delete state.status;
      expect(
        await invoke(ipcChannels.getVehicleSnapshot, { vehicleId: "vehicle-1", refresh: true }),
      ).toMatchObject({ ok: true, data: { availability: { status: true, battery: true } } });
      await expect(store.load()).resolves.toEqual(session);
    },
  );
  it("propagates a real travel reader HTTP401 through the same session boundary", async () => {
    const { state } = await setup();
    state.month = new NinebotHttpError(401);
    expect(
      await invoke(ipcChannels.listRides, { vehicleId: "vehicle-1", month: "202610" }),
    ).toMatchObject({ ok: false, error: { code: "AUTH_REQUIRED" } });
    expect(await invoke(ipcChannels.getVehicleSnapshot, { vehicleId: "vehicle-1" })).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });
});
