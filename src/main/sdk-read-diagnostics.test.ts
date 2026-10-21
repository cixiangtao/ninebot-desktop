import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryNinebotAuthSessionStore,
  NinebotAuthSessionManager,
  PassportLoginBusinessError,
} from "@jiuhao/ninebot-client";
import { ipcChannels, type BridgeResult } from "../shared/contracts.js";
import { registerIpcHandlers } from "./ipc.js";
import { createSdkDesktopRuntime } from "./sdk-desktop-runtime.js";
import { normalizeSdkAuthError } from "./sdk-app-client.js";
import { createRuntimeDiagnosticCollector } from "./runtime-diagnostics.js";

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
const invoke = (channel: string, input?: unknown) => handlers.get(channel)!(null, input);
afterEach(() => {
  handlers.clear();
  vi.unstubAllGlobals();
});

const setup = async () => {
  let now = 1_800_000_000_000;
  let rejectRefresh = false;
  let rejectMonth = false;
  let rejectDetail = false;
  const fetch = vi.fn(async () => {
    throw new Error("Network prohibited");
  });
  vi.stubGlobal("fetch", fetch);
  const store = createMemoryNinebotAuthSessionStore({
    accessToken: "original-SECRET",
    refreshToken: "refresh-SECRET",
    businessUid: "account-SECRET",
    expiresAtMs: now + 90_000,
  });
  const refresh = vi.fn(async () => {
    if (rejectRefresh) throw new PassportLoginBusinessError(90016, "upstream-SECRET");
    return {
      accessToken: "rotated-SECRET",
      refreshToken: "refresh-SECRET",
      businessUid: "account-SECRET",
      expiresAtMs: now + 3_600_000,
    };
  });
  const auth = new NinebotAuthSessionManager({
    store,
    now: () => now,
    provider: {
      loginWithPassword: async () => {
        throw new Error("Login prohibited");
      },
      requestSmsCode: async () => {
        throw new Error("SMS prohibited");
      },
      loginWithSmsCode: async () => {
        throw new Error("Login prohibited");
      },
      refresh,
      whoami: async <T>() => ({ username: "profile-SECRET" }) as T,
    },
  });
  const collector = createRuntimeDiagnosticCollector(() => now);
  const used: string[] = [];
  const ensure = async () => {
    try {
      used.push((await auth.ensureSession()).accessToken);
    } catch (error) {
      throw normalizeSdkAuthError(error);
    }
  };
  const month = vi.fn(async () => {
    await ensure();
    if (rejectMonth) throw new Error("month-response-SECRET");
    return {
      list: [
        { travel_id: "ride-SECRET", mileages: 1, duration: 60, start_time: 100, end_time: 160 },
      ],
    };
  });
  const detail = vi.fn(async () => {
    await ensure();
    if (rejectDetail) throw new Error("detail-response-SECRET");
    return { duration: 60, mileages: 1, trail: "13.388,52.517,10,1;13.39,52.518,20,1" };
  });
  const client = await createSdkDesktopRuntime({
    configDirectory: "/not-used-synthetic",
    auth,
    onDiagnostic: collector.record,
    readers: {
      vehicleReader: {
        vehicles: async () => {
          await ensure();
          return [{ wnumber: "vehicle-SECRET", device_name: "synthetic" }];
        },
      },
      telemetryReader: { vehicleStatus: async () => ({}), battery: async () => ({}) },
      travelReader: { rides: month, rideDetail: detail },
    },
  });
  registerIpcHandlers(client, client, client, client, {
    onDiagnostic: collector.record,
    now: () => now,
  });
  await invoke(ipcChannels.listVehicles);
  return {
    auth,
    store,
    refresh,
    month,
    detail,
    fetch,
    used,
    client,
    collector,
    advance: (delta: number) => {
      now += delta;
    },
    rejectRefresh: () => {
      rejectRefresh = true;
    },
    rejectMonth: () => {
      rejectMonth = true;
    },
    rejectDetail: () => {
      rejectDetail = true;
    },
  };
};
const monthInput = { vehicleId: "vehicle-1", month: "202610" };
const detailInput = { vehicleId: "vehicle-1", rideId: "ride-1" };

describe("SDK restore, real IPC/cache boundaries and synthetic business diagnostics", () => {
  it("distinguishes cached reads at eligibility from natural refresh and fresh post-refresh business completion", async () => {
    const x = await setup();
    expect(await invoke(ipcChannels.listRides, monthInput)).toMatchObject({ ok: true });
    expect(await invoke(ipcChannels.getRideDetail, detailInput)).toMatchObject({ ok: true });
    x.advance(30_001); // The real manager reaches its normal skew boundary; no session mutation.
    expect(x.auth.getRefreshEligibility().status).toBe("due");
    const before = x.collector.snapshot().sequence;
    await invoke(ipcChannels.listRides, monthInput);
    await invoke(ipcChannels.getRideDetail, detailInput);
    const cached = x.collector.snapshot();
    expect(x.refresh).not.toHaveBeenCalled();
    expect(x.month).toHaveBeenCalledOnce();
    expect(x.detail).toHaveBeenCalledOnce();
    expect(cached.signals["cache.ride-month.hit"]?.count).toBe(1);
    expect(cached.signals["cache.ride-detail.hit"]?.count).toBe(1);
    expect(
      cached.events
        .filter(({ sequence }) => sequence > before)
        .some(({ event }) => event.category === "auth"),
    ).toBe(false);
    x.advance(90_000); // Monthly TTL expires naturally; detail TTL is still valid.
    await invoke(ipcChannels.listRides, monthInput);
    const refreshed = x.collector.snapshot();
    expect(x.refresh).toHaveBeenCalledOnce();
    const refreshSequence = refreshed.signals["auth.refresh.completed.expiry"]!.lastSequence;
    expect(refreshed.signals["cache.ride-month.upstream-completed"]!.lastSequence).toBeGreaterThan(
      refreshSequence,
    );
    expect(refreshed.signals["read.ride-month.completed"]!.lastSequence).toBeGreaterThan(
      refreshSequence,
    );
    expect(x.used.at(-1)).toBe("rotated-SECRET");
    await invoke(ipcChannels.getRideDetail, detailInput);
    expect(x.detail).toHaveBeenCalledOnce();
    expect(
      x.collector.snapshot().signals["cache.ride-detail.upstream-completed"]!.lastSequence,
    ).toBeLessThan(refreshSequence);
    await invoke(ipcChannels.getRideDetail, { ...detailInput, refresh: true }); // Business cache bypass, not an auth refresh call.
    expect(x.refresh).toHaveBeenCalledOnce();
    expect(x.detail).toHaveBeenCalledTimes(2);
    expect(
      x.collector.snapshot().signals["cache.ride-detail.upstream-completed"]!.lastSequence,
    ).toBeGreaterThan(refreshSequence);
    await clientProfile(x);
    const restored = new NinebotAuthSessionManager({
      provider: {
        loginWithPassword: async () => {
          throw new Error("unused");
        },
        requestSmsCode: async () => {},
        loginWithSmsCode: async () => {
          throw new Error("unused");
        },
        whoami: async <T>() => null as T,
      },
      store: x.store,
    });
    await restored.restore();
    expect(restored.getSession()?.accessToken).toBe("rotated-SECRET");
    expect(JSON.stringify(x.collector.snapshot())).not.toMatch(
      /SECRET|13\.388|52\.517|202610|vehicle-1|ride-1/,
    );
    expect(x.fetch).not.toHaveBeenCalled();
  });

  it("records month/detail failures without leaking error bodies or caching failed loads", async () => {
    const x = await setup();
    await invoke(ipcChannels.listRides, monthInput);
    x.rejectDetail();
    expect(await invoke(ipcChannels.getRideDetail, detailInput)).toMatchObject({ ok: false });
    expect(x.collector.snapshot().signals["cache.ride-detail.upstream-failed"]?.count).toBe(1);
    expect(x.collector.snapshot().signals["read.ride-detail.failed"]?.count).toBe(1);
    expect(x.collector.snapshot().signals["cache.ride-detail.upstream-completed"]).toBeUndefined();
    x.rejectMonth();
    expect(await invoke(ipcChannels.listRides, { ...monthInput, refresh: true })).toMatchObject({
      ok: false,
    });
    expect(x.collector.snapshot().signals["cache.ride-month.upstream-failed"]?.count).toBe(1);
    expect(x.collector.snapshot().signals["read.ride-month.failed"]?.count).toBe(1);
    expect(JSON.stringify(x.collector.snapshot())).not.toContain("SECRET");
    expect(x.fetch).not.toHaveBeenCalled();
  });

  it("does not mark business success when an eligible automatic refresh fails", async () => {
    const x = await setup();
    x.rejectRefresh();
    x.advance(30_001);
    expect(await invoke(ipcChannels.listRides, monthInput)).toMatchObject({
      ok: false,
      error: { code: "AUTH_REQUIRED" },
    });
    const snapshot = x.collector.snapshot();
    expect(snapshot.signals["auth.refresh.failed.expiry"]?.count).toBe(1);
    expect(snapshot.signals["auth.refresh.completed.expiry"]).toBeUndefined();
    expect(snapshot.signals["cache.ride-month.upstream-completed"]).toBeUndefined();
    expect(snapshot.signals["read.ride-month.completed"]).toBeUndefined();
    expect((await x.store.load())?.accessToken).toBe("original-SECRET");
    expect(JSON.stringify(snapshot)).not.toContain("SECRET");
    expect(x.fetch).not.toHaveBeenCalled();
  });
});

const clientProfile = async (x: Awaited<ReturnType<typeof setup>>) => {
  await x.client.whoami();
  expect(x.collector.snapshot().signals["auth.whoami.completed"]!.lastSequence).toBeGreaterThan(
    x.collector.snapshot().signals["auth.refresh.completed.expiry"]!.lastSequence,
  );
};
