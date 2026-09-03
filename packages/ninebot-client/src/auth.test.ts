import { describe, expect, it, vi } from "vitest";
import {
  createMemoryNinebotAuthSessionStore,
  NinebotAuthSessionManager,
  type NinebotAuthProvider,
  type NinebotAuthSession,
} from "./auth.ts";

const session = { accessToken: "token", businessUid: "uid", expiresAtMs: 2_000 } as const;

const createProvider = (overrides: Partial<NinebotAuthProvider> = {}) =>
  ({
    loginWithPassword: vi.fn().mockResolvedValue(session),
    requestSmsCode: vi.fn().mockResolvedValue(undefined),
    loginWithSmsCode: vi.fn().mockResolvedValue(session),
    whoami: vi.fn().mockResolvedValue({ connected: true }),
    refresh: vi.fn().mockResolvedValue({ ...session, accessToken: "refreshed" }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }) satisfies NinebotAuthProvider;

describe("Ninebot auth session manager", () => {
  it("persists login results without retaining password credentials", async () => {
    const provider = createProvider();
    const store = createMemoryNinebotAuthSessionStore();
    const manager = new NinebotAuthSessionManager({ provider, store });

    await manager.loginWithPassword({ areaCode: "+86", user: "user", password: "secret" });

    expect(manager.getSession()).toEqual(session);
    expect(await store.load()).toEqual(session);
    expect(JSON.stringify(manager)).not.toContain("secret");
  });

  it("refreshes an expiring session before whoami", async () => {
    const provider = createProvider();
    const store = createMemoryNinebotAuthSessionStore(session);
    const manager = new NinebotAuthSessionManager({
      provider,
      store,
      now: () => 1_500,
      refreshSkewMs: 600,
    });
    await manager.restore();

    await expect(manager.whoami()).resolves.toEqual({ connected: true });
    expect(provider.refresh).toHaveBeenCalledWith(session);
    expect(provider.whoami).toHaveBeenCalledWith({
      ...session,
      accessToken: "refreshed",
    });
  });

  it("exposes the fresh session for domain clients", async () => {
    const provider = createProvider();
    const manager = new NinebotAuthSessionManager({
      provider,
      store: createMemoryNinebotAuthSessionStore(session),
      now: () => 1_500,
      refreshSkewMs: 600,
    });
    await manager.restore();

    await expect(manager.ensureSession()).resolves.toEqual({
      ...session,
      accessToken: "refreshed",
    });
    expect(provider.refresh).toHaveBeenCalledWith(session);
  });

  it("shares one refresh operation across concurrent domain requests", async () => {
    let resolveRefresh: ((value: NinebotAuthSession) => void) | undefined;
    const provider = createProvider({
      refresh: vi.fn(
        () =>
          new Promise<NinebotAuthSession>((resolve) => {
            resolveRefresh = resolve;
          }),
      ),
    });
    const manager = new NinebotAuthSessionManager({
      provider,
      store: createMemoryNinebotAuthSessionStore(session),
      now: () => 1_500,
      refreshSkewMs: 600,
    });
    await manager.restore();

    const first = manager.ensureSession();
    const second = manager.ensureSession();
    expect(provider.refresh).toHaveBeenCalledTimes(1);
    resolveRefresh?.({ ...session, accessToken: "refreshed" });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { ...session, accessToken: "refreshed" },
      { ...session, accessToken: "refreshed" },
    ]);
  });

  it("fails closed when an expired session cannot refresh", async () => {
    const provider: NinebotAuthProvider = createProvider();
    delete provider.refresh;
    const manager = new NinebotAuthSessionManager({
      provider,
      store: createMemoryNinebotAuthSessionStore(session),
      now: () => 2_000,
      refreshSkewMs: 0,
    });
    await manager.restore();

    await expect(manager.whoami()).rejects.toThrow("does not support token refresh");
    expect(provider.whoami).not.toHaveBeenCalled();
  });

  it("clears local credentials when upstream logout fails", async () => {
    const provider = createProvider({ logout: vi.fn().mockRejectedValue(new Error("offline")) });
    const store = createMemoryNinebotAuthSessionStore(session);
    const manager = new NinebotAuthSessionManager({ provider, store });
    await manager.restore();

    await expect(manager.logout()).rejects.toThrow("offline");
    expect(manager.isAuthenticated).toBe(false);
    await expect(store.load()).resolves.toBeNull();
  });
});
