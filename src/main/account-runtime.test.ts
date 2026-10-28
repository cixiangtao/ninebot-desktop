import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import {
  NinebotAuthSessionManager,
  createFileNinebotAuthSessionStore,
} from "@jiuhao/ninebot-client/node";
import { createMultiAccountRuntime, type AccountProfileRuntime } from "./account-runtime.js";
import { NinebotClientError } from "./app-client.js";
import type { RuntimeSecurityStatus } from "../shared/contracts.js";

const phoneA = "15500000001";
const phoneB = "15500000002";
const session = (user: string, token = `access-${user}`) => ({
  accessToken: token,
  refreshToken: `refresh-${user}`,
  businessUid: `uid-${user}`,
  uuid: `uuid-${user}`,
  expiresAtMs: 2_000_000,
});

const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "ninebot-accounts-"));
  const logins = vi.fn();
  const refreshes = vi.fn();
  let vehicleGate: (() => Promise<unknown>) | null = null;
  const createRuntime = async (path: string): Promise<AccountProfileRuntime> => {
    const auth = new NinebotAuthSessionManager({
      store: createFileNinebotAuthSessionStore({ directory: path, legacyFileName: false }),
      now: () => 1_000_000,
      provider: {
        loginWithPassword: async ({ user, password }) => {
          logins(user);
          if (password === "reject") throw new NinebotClientError("rejected", "auth");
          return session(user, password);
        },
        requestSmsCode: async () => {},
        loginWithSmsCode: async ({ phone }) => {
          logins(phone);
          return session(phone);
        },
        whoami: async <T>(value: { businessUid: string }) =>
          ({ phone: value.businessUid.slice(4), areaCode: "86" }) as T,
        refresh: async (value) => {
          refreshes(value.businessUid);
          return { ...value, accessToken: "rotated", expiresAtMs: 3_000_000 };
        },
      },
    });
    await auth.restore();
    return {
      auth,
      stopDiagnostics: vi.fn(),
      clear: vi.fn(),
      login: async (user, areaCode, password) => {
        await auth.loginWithPassword({ user, areaCode, password });
      },
      requestSmsCode: async (phone, areaCode, validate, signal) =>
        auth.requestSmsCode({
          phone,
          areaCode,
          ...(validate ? { validate } : {}),
          ...(signal ? { signal } : {}),
        }),
      loginWithSmsCode: async (phone, areaCode, code) => {
        await auth.loginWithSmsCode({ phone, areaCode, code });
      },
      logout: () => auth.logout(),
      whoami: () => auth.whoami(),
      vehicles: async () =>
        vehicleGate ? vehicleGate() : [(await auth.ensureSession()).businessUid],
      vehicleStatus: async () => ({}),
      battery: async () => ({}),
      rides: async () => ({}),
      rideDetail: async () => ({}),
      diagnostics: async () => ({}) as RuntimeSecurityStatus,
    };
  };
  const open = () => createMultiAccountRuntime({ directory, createRuntime });
  return {
    directory,
    open,
    logins,
    refreshes,
    gate: (next: typeof vehicleGate) => {
      vehicleGate = next;
    },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
};

describe("independent local account sessions", () => {
  it("persists token rotation in the selected account's store across switches and restart", async () => {
    const f = await fixture();
    try {
      await writeFile(
        join(f.directory, "auth-session.json"),
        JSON.stringify({ ...session(phoneA), expiresAtMs: 1_000_001 }),
      );
      const client = await f.open();
      const a = (await client.accounts!.list()).activeId!;
      await client.vehicles();
      expect(f.refreshes).toHaveBeenCalledExactlyOnceWith(`uid-${phoneA}`);
      expect(
        JSON.parse(await readFile(join(f.directory, "auth-session.json"), "utf8")).accessToken,
      ).toBe("rotated");
      await client.login(phoneB, "86", "token-b");
      await client.accounts!.switch(a);
      expect(await (await f.open()).vehicles()).toEqual([`uid-${phoneA}`]);
      expect(f.refreshes).toHaveBeenCalledTimes(1);
      expect(f.logins).toHaveBeenCalledTimes(1);
    } finally {
      await f.cleanup();
    }
  });

  it("preserves malformed registry and existing credentials rather than overwriting them", async () => {
    const f = await fixture();
    try {
      await writeFile(join(f.directory, "accounts.json"), "malformed-private-index");
      await writeFile(join(f.directory, "auth-session.json"), JSON.stringify(session(phoneA)));
      await expect(f.open()).rejects.toMatchObject({ kind: "upstream" });
      expect(await readFile(join(f.directory, "accounts.json"), "utf8")).toBe(
        "malformed-private-index",
      );
      expect(
        JSON.parse(await readFile(join(f.directory, "auth-session.json"), "utf8")).accessToken,
      ).toBe(`access-${phoneA}`);
      expect(f.logins).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  });
  it("migrates an existing SDK session without changing its bytes or adopting legacy tokens", async () => {
    const f = await fixture();
    try {
      const original = JSON.stringify(session(phoneA));
      await writeFile(join(f.directory, "auth-session.json"), original);
      await writeFile(join(f.directory, "tokens.json"), "legacy-private");
      const client = await f.open();
      expect((await client.accounts!.list()).accounts).toHaveLength(1);
      expect(await client.vehicles()).toEqual([`uid-${phoneA}`]);
      expect(await readFile(join(f.directory, "auth-session.json"), "utf8")).toBe(original);
      await client.whoami();
      const summary = JSON.stringify(await client.accounts!.list());
      expect(summary).toContain("155****0001");
      expect(summary).not.toContain(phoneA);
      expect(summary).not.toMatch(/access-|refresh-|uid-/);
      const index = await readFile(join(f.directory, "accounts.json"), "utf8");
      expect(index).not.toMatch(/access-|refresh-|uid-/);
      if (process.platform !== "win32")
        expect((await stat(join(f.directory, "accounts.json"))).mode & 0o777).toBe(0o600);
      await client.logout();
      expect(await readFile(join(f.directory, "tokens.json"), "utf8")).toBe("legacy-private");
      expect((await (await f.open()).accounts!.list()).accounts).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });

  it("adds, switches and restores accounts without another upstream login", async () => {
    const f = await fixture();
    try {
      const client = await f.open();
      await client.login(phoneA, "86", "token-a");
      const a = (await client.accounts!.list()).activeId!;
      await client.loginWithSmsCode(phoneB, "86", "123456");
      const b = (await client.accounts!.list()).activeId!;
      expect(a).not.toBe(b);
      expect((await client.accounts!.list()).accounts).toHaveLength(2);
      await client.accounts!.switch(a);
      expect(await client.vehicles()).toEqual([`uid-${phoneA}`]);
      const restarted = await f.open();
      expect((await restarted.accounts!.list()).activeId).toBe(a);
      expect(await restarted.vehicles()).toEqual([`uid-${phoneA}`]);
      await restarted.accounts!.switch(b);
      expect(await restarted.vehicles()).toEqual([`uid-${phoneB}`]);
      expect(f.logins).toHaveBeenCalledTimes(2);
      expect(f.refreshes).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  });

  it("preserves the active account on failed login or an unknown switch", async () => {
    const f = await fixture();
    try {
      const client = await f.open();
      await client.login(phoneA, "86", "token-a");
      const before = await client.accounts!.list();
      await expect(client.login(phoneB, "86", "reject")).rejects.toMatchObject({ kind: "auth" });
      await expect(client.accounts!.switch("missing")).rejects.toMatchObject({ kind: "upstream" });
      expect(await client.accounts!.list()).toEqual(before);
      expect(await client.vehicles()).toEqual([`uid-${phoneA}`]);
      expect(await (await f.open()).vehicles()).toEqual([`uid-${phoneA}`]);
    } finally {
      await f.cleanup();
    }
  });

  it("replaces the same identity in place and keeps the other account", async () => {
    const f = await fixture();
    try {
      const client = await f.open();
      await client.login(phoneA, "86", "old-a");
      const a = (await client.accounts!.list()).activeId!;
      await client.login(phoneB, "86", "token-b");
      const b = (await client.accounts!.list()).activeId!;
      await client.login(phoneA, "86", "new-a");
      expect((await client.accounts!.list()).activeId).toBe(a);
      expect((await client.accounts!.list()).accounts).toHaveLength(2);
      await client.accounts!.remove(b);
      expect((await client.accounts!.list()).activeId).toBe(a);
      expect(await client.vehicles()).toEqual([`uid-${phoneA}`]);
      await client.logout();
      expect((await (await f.open()).accounts!.list()).accounts).toHaveLength(0);
    } finally {
      await f.cleanup();
    }
  });

  it("drops both late successes and late authentication failures from the previous account", async () => {
    const f = await fixture();
    try {
      const client = await f.open();
      await client.login(phoneA, "86", "token-a");
      const a = (await client.accounts!.list()).activeId!;
      await client.login(phoneB, "86", "token-b");
      const b = (await client.accounts!.list()).activeId!;
      let finish!: (value: unknown) => void;
      f.gate(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const oldSuccess = client.vehicles();
      await client.accounts!.switch(a);
      finish(["private-old-account"]);
      await expect(oldSuccess).rejects.toMatchObject({ kind: "upstream" });
      let fail!: (error: unknown) => void;
      f.gate(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      );
      const oldFailure = client.vehicles();
      await client.accounts!.switch(b);
      fail(new NinebotClientError("old auth expired", "auth"));
      await expect(oldFailure).rejects.toMatchObject({ kind: "upstream" });
      expect((await client.accounts!.list()).accounts.every((row) => !row.needsLogin)).toBe(true);
    } finally {
      await f.cleanup();
    }
  });

  it("marks only the current failed session for reauthentication", async () => {
    const f = await fixture();
    try {
      const client = await f.open();
      await client.login(phoneA, "86", "token-a");
      await client.login(phoneB, "86", "token-b");
      const b = (await client.accounts!.list()).activeId!;
      f.gate(async () => {
        throw new NinebotClientError("expired", "auth");
      });
      await expect(client.vehicles()).rejects.toMatchObject({ kind: "auth" });
      expect(
        (await client.accounts!.list()).accounts
          .filter((row) => row.needsLogin)
          .map((row) => row.id),
      ).toEqual([b]);
    } finally {
      await f.cleanup();
    }
  });
});
