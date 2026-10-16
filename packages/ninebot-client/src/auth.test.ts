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
  it("does not restore credentials when a refresh finishes after logout", async () => {
    let finish!: (session: NinebotAuthSession) => void;
    const provider = createProvider({
      refresh: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const store = createMemoryNinebotAuthSessionStore(session);
    const manager = new NinebotAuthSessionManager({ provider, store });
    await manager.restore();
    const refreshing = manager.refresh();
    const rejected = expect(refreshing).rejects.toThrow("superseded");
    await manager.logout();
    finish({ ...session, accessToken: "late-refresh" });
    await rejected;
    expect(manager.isAuthenticated).toBe(false);
    await expect(store.load()).resolves.toBeNull();
  });

  it("does not let an older login replace a newer account", async () => {
    let finish!: (session: NinebotAuthSession) => void;
    const login = vi
      .fn<NinebotAuthProvider["loginWithPassword"]>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...session, businessUid: "new-account" });
    const store = createMemoryNinebotAuthSessionStore();
    const manager = new NinebotAuthSessionManager({
      provider: createProvider({ loginWithPassword: login }),
      store,
    });
    const first = manager.loginWithPassword({ areaCode: "86", user: "old", password: "old" });
    const rejected = expect(first).rejects.toThrow("superseded");
    await manager.loginWithPassword({ areaCode: "86", user: "new", password: "new" });
    finish({ ...session, businessUid: "old-account" });
    await rejected;
    expect(manager.getSession()?.businessUid).toBe("new-account");
    expect((await store.load())?.businessUid).toBe("new-account");
  });

  it("clears after a persistence operation already in flight", async () => {
    let begin!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const memory = createMemoryNinebotAuthSessionStore();
    const manager = new NinebotAuthSessionManager({
      provider: createProvider(),
      store: {
        ...memory,
        async save(value) {
          begin();
          await blocked;
          await memory.save(value);
        },
      },
    });
    const login = manager.loginWithPassword({ areaCode: "86", user: "user", password: "secret" });
    const rejected = expect(login).rejects.toThrow("superseded");
    await started;
    const logout = manager.logout();
    finish();
    await Promise.all([rejected, logout]);
    await expect(memory.load()).resolves.toBeNull();
    expect(manager.isAuthenticated).toBe(false);
  });

  it("does not let a refresh started during login overwrite the new account", async () => {
    let finishLogin!: (value: NinebotAuthSession) => void;
    let finishRefresh!: (value: NinebotAuthSession) => void;
    const provider = createProvider({
      loginWithPassword: () =>
        new Promise((resolve) => {
          finishLogin = resolve;
        }),
      refresh: () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        }),
    });
    const store = createMemoryNinebotAuthSessionStore(session);
    const manager = new NinebotAuthSessionManager({ provider, store });
    await manager.restore();
    const login = manager.loginWithPassword({ areaCode: "86", user: "new", password: "new" });
    const refreshing = manager.refresh();
    const rejected = expect(refreshing).rejects.toThrow("superseded");
    finishLogin({ ...session, businessUid: "new-account" });
    await login;
    finishRefresh({ ...session, accessToken: "late-old-token" });
    await rejected;
    expect(manager.getSession()?.businessUid).toBe("new-account");
    expect((await store.load())?.businessUid).toBe("new-account");
  });

  it("rolls back a superseded save when the newer login fails", async () => {
    let begin!: () => void;
    let finish!: () => void;
    const started = new Promise<void>((resolve) => {
      begin = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const memory = createMemoryNinebotAuthSessionStore(session);
    const save = vi.fn(async (value: NinebotAuthSession) => {
      if (value.businessUid === "superseded-account") {
        begin();
        await blocked;
      }
      await memory.save(value);
    });
    const login = vi
      .fn<NinebotAuthProvider["loginWithPassword"]>()
      .mockResolvedValueOnce({ ...session, businessUid: "superseded-account" })
      .mockRejectedValueOnce(new Error("new login failed"));
    const manager = new NinebotAuthSessionManager({
      provider: createProvider({ loginWithPassword: login }),
      store: { ...memory, save },
    });
    await manager.restore();
    const first = manager.loginWithPassword({ areaCode: "86", user: "first", password: "secret" });
    const rejected = expect(first).rejects.toThrow("superseded");
    await started;
    await expect(
      manager.loginWithPassword({ areaCode: "86", user: "second", password: "secret" }),
    ).rejects.toThrow("new login failed");
    finish();
    await rejected;
    expect(manager.getSession()).toEqual(session);
    await expect(memory.load()).resolves.toEqual(session);
  });

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
