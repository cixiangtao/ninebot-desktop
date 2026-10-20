import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createMemoryNinebotAuthSessionStore,
  createNinebotPassportAuthProvider,
  NinebotAuthSessionManager,
  NinebotBusinessSessionError,
  PassportLoginBusinessError,
  type NinebotPassportAuthClient,
} from "@jiuhao/ninebot-client";
import { ipcChannels, type BridgeResult } from "../shared/contracts.js";
import { createSdkDesktopRuntime, resolveDesktopAuthSource } from "./sdk-desktop-runtime.js";
import { registerIpcHandlers } from "./ipc.js";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<BridgeResult<unknown>>>(),
  sessions: [] as unknown[],
  clears: 0,
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => Promise<BridgeResult<unknown>>) =>
      mocks.handlers.set(name, handler),
  },
  BrowserWindow: {},
  dialog: {},
}));
vi.mock("./vehicle-source.js", () => ({
  createCandidateVehicleReader: ({
    sessionProvider,
  }: {
    sessionProvider: () => Promise<unknown>;
  }) => ({
    vehicles: async () => {
      mocks.sessions.push(await sessionProvider());
      return [];
    },
    clear: () => {
      mocks.clears += 1;
    },
  }),
}));
vi.mock("./telemetry-source.js", () => ({
  createCandidateTelemetryReader: () => ({
    clear: () => {
      mocks.clears += 1;
    },
  }),
}));
vi.mock("./travel-source.js", () => ({
  createCandidateTravelReader: () => ({
    clear: () => {
      mocks.clears += 1;
    },
  }),
}));

const invoke = (name: string, input?: unknown) => mocks.handlers.get(name)!(null, input);

describe("SDK desktop authentication through real IPC handlers (synthetic providers)", () => {
  it("propagates expired-session refresh rejection from domain reads as AUTH_REQUIRED", async () => {
    mocks.sessions.length = 0;
    mocks.clears = 0;
    const session = {
      accessToken: "synthetic",
      refreshToken: "synthetic",
      businessUid: "synthetic",
      expiresAtMs: 1,
    };
    const store = createMemoryNinebotAuthSessionStore(session);
    const auth = new NinebotAuthSessionManager({
      store,
      provider: {
        loginWithPassword: async () => session,
        requestSmsCode: async () => undefined,
        loginWithSmsCode: async () => session,
        refresh: async () => {
          throw new PassportLoginBusinessError(90016, "synthetic-private");
        },
        whoami: async <T>() => null as T,
      },
    });
    const client = await createSdkDesktopRuntime({ configDirectory: "/unused-synthetic", auth });
    registerIpcHandlers(client);
    const result = await invoke(ipcChannels.listVehicles);
    expect(result).toMatchObject({ ok: false, error: { code: "AUTH_REQUIRED" } });
    expect(JSON.stringify(result)).not.toContain("synthetic-private");
    expect(mocks.sessions).toHaveLength(0);
    expect(mocks.clears).toBeGreaterThanOrEqual(3);
    await expect(store.load()).resolves.toEqual(session);
  });
  it("the real desktop SDK factory never adopts or deletes a legacy session", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ninebot-sdk-isolation-"));
    const legacy = "synthetic old session, deliberately not SDK JSON";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await writeFile(join(directory, "tokens.json"), legacy);
      const client = await createSdkDesktopRuntime({ configDirectory: directory });
      expect(warn).not.toHaveBeenCalled();
      await expect(client.whoami()).rejects.toMatchObject({ kind: "auth" });
      await client.logout();
      expect(await readFile(join(directory, "tokens.json"), "utf8")).toBe(legacy);
    } finally {
      warn.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires explicit SDK selection", () => {
    expect(resolveDesktopAuthSource({})).toBe("legacy");
    expect(resolveDesktopAuthSource({ NINEBOT_AUTH_SOURCE: "sdk" })).toBe("sdk");
    expect(resolveDesktopAuthSource({ NINEBOT_AUTH_SOURCE: "unknown" })).toBe("legacy");
  });

  it("handles challenges, failed bootstrap, complete login, refresh, restart and logout", async () => {
    mocks.sessions.length = 0;
    let now = 1_725_000_000_000;
    let failBusiness = true;
    let challenge = true;
    const account = {
      accessToken: "synthetic-access",
      refreshToken: "synthetic-refresh",
      uuid: "synthetic-uuid",
      expiresAtMs: now + 120_000,
    };
    const passport = {
      loginWithPassword: vi.fn(async () => account),
      requestSmsCode: vi.fn(async () => {
        if (challenge)
          throw new PassportLoginBusinessError(90202, "send code need verify synthetic-private");
      }),
      loginWithSmsCode: vi.fn(async () => account),
      refresh: vi.fn(async () => ({
        ...account,
        accessToken: "synthetic-rotated",
        expiresAtMs: now + 3_600_000,
      })),
      whoami: (async <T>() =>
        ({
          username: "synthetic-account",
          hasPassword: true,
        }) as T) as NinebotPassportAuthClient["whoami"],
    };
    const provider = createNinebotPassportAuthProvider(passport, {
      initializeBusinessSession: async () => {
        if (failBusiness) throw new NinebotBusinessSessionError("business");
        return "synthetic-business-uid";
      },
    });
    const store = createMemoryNinebotAuthSessionStore();
    const create = async () => {
      const auth = new NinebotAuthSessionManager({ provider, store, now: () => now });
      const client = await createSdkDesktopRuntime({ configDirectory: "/unused-synthetic", auth });
      registerIpcHandlers(client);
      return { auth, client };
    };
    const { auth, client } = await create();
    await expect(invoke(ipcChannels.authStatus)).resolves.toEqual({
      ok: true,
      data: { connected: false },
    });
    const rejected = await invoke(ipcChannels.requestSmsCode, {
      areaCode: "86",
      phone: "15500000000",
    });
    expect(rejected).toMatchObject({ ok: false, error: { code: "HUMAN_VERIFICATION_REQUIRED" } });
    expect(JSON.stringify(rejected)).not.toContain("synthetic-private");
    challenge = false;
    await expect(
      invoke(ipcChannels.requestSmsCode, { areaCode: "86", phone: "15500000000" }),
    ).resolves.toEqual({ ok: true, data: { sent: true } });
    await expect(
      invoke(ipcChannels.passwordLogin, {
        areaCode: "86",
        user: "synthetic",
        password: "synthetic-password",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "UPSTREAM_ERROR" } });
    expect(auth.isAuthenticated).toBe(false);
    await expect(store.load()).resolves.toBeNull();
    failBusiness = false;
    await expect(
      invoke(ipcChannels.smsCodeLogin, { areaCode: "86", phone: "15500000000", code: "123456" }),
    ).resolves.toEqual({ ok: true, data: { connected: true } });
    expect(passport.loginWithSmsCode).toHaveBeenCalledWith({
      areaCode: "86",
      phone: "15500000000",
      code: "123456",
    });
    now += 120_001;
    await client.vehicles();
    expect(passport.refresh).toHaveBeenCalledOnce();
    expect(mocks.sessions.at(-1)).toMatchObject({
      accessToken: "synthetic-rotated",
      businessUid: "synthetic-business-uid",
    });
    await create();
    await expect(invoke(ipcChannels.authStatus)).resolves.toEqual({
      ok: true,
      data: { connected: true },
    });
    expect(passport.loginWithPassword).toHaveBeenCalledOnce();
    await expect(invoke(ipcChannels.authLogout)).resolves.toEqual({
      ok: true,
      data: { connected: false },
    });
    await create();
    await expect(invoke(ipcChannels.authStatus)).resolves.toEqual({
      ok: true,
      data: { connected: false },
    });
  });

  it("preserves unreadable/incomplete material and leaves explicit login available", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = {
      load: vi.fn(async () => {
        throw new Error("synthetic-private-file-content");
      }),
      save: vi.fn(),
      clear: vi.fn(),
    };
    const auth = new NinebotAuthSessionManager({
      store,
      provider: {
        loginWithPassword: async () => ({ accessToken: "a", businessUid: "u" }),
        requestSmsCode: async () => undefined,
        loginWithSmsCode: async () => ({ accessToken: "a", businessUid: "u" }),
        whoami: async <T>() => null as T,
      },
    });
    const client = await createSdkDesktopRuntime({ configDirectory: "/unused-synthetic", auth });
    await expect(client.whoami()).rejects.toMatchObject({ kind: "auth" });
    expect(store.save).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("synthetic-private-file-content");
    await client.login("synthetic", "86", "synthetic");
    expect(store.save).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
