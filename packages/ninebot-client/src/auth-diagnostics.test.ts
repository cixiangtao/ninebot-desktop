import { describe, expect, it, vi } from "vitest";
import {
  createMemoryNinebotAuthSessionStore,
  NinebotAuthSessionManager,
  type NinebotAuthDiagnosticEvent,
  type NinebotAuthProvider,
  type NinebotAuthSession,
} from "./auth.ts";

const initial = {
  accessToken: "secret-access-NEVER-LOG",
  refreshToken: "secret-refresh-NEVER-LOG",
  uuid: "private-uuid-NEVER-LOG",
  businessUid: "private-uid-NEVER-LOG",
  expiresAtMs: 1_000_000,
};
const make = (
  overrides: Partial<NinebotAuthProvider> = {},
  stored: NinebotAuthSession | null = initial,
) => {
  let now = 900_000;
  const provider = {
    loginWithPassword: vi.fn(async () => initial),
    requestSmsCode: vi.fn(async () => undefined),
    loginWithSmsCode: vi.fn(async () => initial),
    whoami: vi.fn().mockResolvedValue({ username: "private-profile-NEVER-LOG" }),
    refresh: vi.fn(async () => ({
      ...initial,
      accessToken: "rotated-secret-NEVER-LOG",
      expiresAtMs: now + 3_600_000,
    })),
    ...overrides,
  };
  const store = createMemoryNinebotAuthSessionStore(stored);
  const save = vi.spyOn(store, "save");
  const manager = new NinebotAuthSessionManager({ provider, store, now: () => now });
  const events: Readonly<NinebotAuthDiagnosticEvent>[] = [];
  manager.observeDiagnostics((event) => events.push(event));
  return {
    manager,
    provider,
    store,
    save,
    events,
    setNow: (value: number) => {
      now = value;
    },
  };
};

describe("safe authentication diagnostics", () => {
  it("reports passive unavailable/fresh/due decisions without extra loads or calls", async () => {
    const x = make();
    const load = vi.spyOn(x.store, "load");
    expect(x.manager.getRefreshEligibility()).toEqual({
      status: "unavailable",
      refreshSupported: true,
      nextEligibleAtMs: null,
    });
    expect(load).not.toHaveBeenCalled();
    await x.manager.restore();
    expect(x.manager.getRefreshEligibility()).toEqual({
      status: "fresh",
      refreshSupported: true,
      nextEligibleAtMs: 940_000,
    });
    x.setNow(940_000);
    expect(x.manager.getRefreshEligibility().status).toBe("due");
    expect(load).toHaveBeenCalledOnce();
    expect(x.provider.refresh).not.toHaveBeenCalled();
    expect(x.provider.whoami).not.toHaveBeenCalled();
    expect(x.save).not.toHaveBeenCalled();
  });

  it("observes restore then request-triggered refresh and subsequent profile, without secrets", async () => {
    const x = make();
    await x.manager.restore();
    await x.manager.ensureSession();
    expect(x.provider.refresh).not.toHaveBeenCalled();
    x.setNow(940_000);
    await x.manager.whoami();
    expect(x.provider.refresh).toHaveBeenCalledOnce();
    expect(x.save).toHaveBeenCalledOnce();
    const refresh = x.events.findIndex(
      (event) =>
        event.kind === "operation" &&
        event.operation === "refresh" &&
        event.outcome === "completed",
    );
    const profile = x.events.findIndex(
      (event) =>
        event.kind === "operation" && event.operation === "whoami" && event.outcome === "completed",
    );
    expect(refresh).toBeGreaterThan(0);
    expect(profile).toBeGreaterThan(refresh);
    expect(x.events).toContainEqual({
      kind: "operation",
      operation: "refresh",
      outcome: "completed",
      trigger: "expiry",
    });
    expect(x.events).toContainEqual({
      kind: "eligibility",
      source: "refresh",
      status: "fresh",
      refreshSupported: true,
      nextEligibleAtMs: 4_480_000,
    });
    expect(JSON.stringify(x.events)).not.toContain("NEVER-LOG");
  });

  it("keeps missing expiry and absent refresh support explicit", async () => {
    const x = make({}, { accessToken: "secret", businessUid: "uid" });
    await x.manager.restore();
    await x.manager.ensureSession();
    expect(x.manager.getRefreshEligibility()).toMatchObject({
      status: "expiry-unknown",
      nextEligibleAtMs: null,
    });
    expect(x.provider.refresh).not.toHaveBeenCalled();
    const { refresh: _refresh, ...provider } = x.provider;
    const manager = new NinebotAuthSessionManager({ provider, store: x.store });
    await manager.restore();
    expect(manager.getRefreshEligibility().refreshSupported).toBe(false);
  });

  it("records one refresh start and shared joins, preserving single flight", async () => {
    let finish!: (session: NinebotAuthSession) => void;
    const refresh = vi.fn(
      () =>
        new Promise<NinebotAuthSession>((done) => {
          finish = done;
        }),
    );
    const x = make({ refresh });
    await x.manager.restore();
    x.setNow(940_000);
    const first = x.manager.ensureSession();
    const second = x.manager.ensureSession();
    finish({ ...initial, expiresAtMs: 9_000_000 });
    await Promise.all([first, second]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(
      x.events.filter(
        (event) =>
          event.kind === "operation" &&
          event.operation === "refresh" &&
          event.outcome === "started",
      ),
    ).toHaveLength(1);
    expect(x.events).toContainEqual({
      kind: "operation",
      operation: "refresh",
      outcome: "joined",
      trigger: "expiry",
    });
  });

  it("distinguishes explicit refresh and preserves original failures and stored session", async () => {
    const failure = new Error("private-upstream-NEVER-LOG");
    const x = make({
      refresh: async () => {
        throw failure;
      },
    });
    await x.manager.restore();
    await expect(x.manager.refresh()).rejects.toBe(failure);
    expect(x.events).toContainEqual({
      kind: "operation",
      operation: "refresh",
      outcome: "failed",
      trigger: "explicit",
    });
    expect(x.save).not.toHaveBeenCalled();
    expect(await x.store.load()).toEqual(initial);
    expect(JSON.stringify(x.events)).not.toContain("NEVER-LOG");
  });

  it("does not let throwing listeners change calls and allows unsubscribe", async () => {
    const x = make();
    const stop = x.manager.observeDiagnostics(() => {
      throw new Error("sink failed");
    });
    const listener = vi.fn();
    const unsubscribe = x.manager.observeDiagnostics(listener);
    await x.manager.restore();
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    unsubscribe();
    stop();
    await x.manager.whoami();
    expect(listener).not.toHaveBeenCalled();
  });

  it("contains rejected asynchronous observers without changing business calls", async () => {
    const x = make();
    x.manager.observeDiagnostics(async () => {
      throw new Error("private sink failure");
    });
    await x.manager.restore();
    await x.manager.whoami();
    expect(x.provider.whoami).toHaveBeenCalledOnce();
  });

  it("records failed restore without leaking file/provider error details", async () => {
    const x = make();
    const failure = new Error("file-body-NEVER-LOG");
    vi.spyOn(x.store, "load").mockRejectedValue(failure);
    await expect(x.manager.restore()).rejects.toBe(failure);
    expect(x.events).toEqual([
      { kind: "operation", operation: "restore", outcome: "started" },
      { kind: "operation", operation: "restore", outcome: "failed" },
    ]);
  });
});
