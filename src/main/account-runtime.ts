import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NinebotAuthSessionManager } from "@jiuhao/ninebot-client/node";
import type { SavedAccountsState, SavedAccount } from "../shared/contracts.js";
import { NinebotClientError, type NinebotAppClient } from "./app-client.js";
import { parseAccountProfile } from "./parsers.js";

export interface AccountProfileRuntime extends NinebotAppClient {
  auth: NinebotAuthSessionManager;
  stopDiagnostics: () => void;
}

interface StoredAccount {
  id: string;
  slot: string;
  identity: string;
  label: string;
  needsLogin: boolean;
}
interface AccountIndex {
  version: 1;
  activeId: string | null;
  accounts: StoredAccount[];
}
const opaqueId = /^[a-f0-9-]{36}$/;
const identityOf = (uid: string) => createHash("sha256").update(uid).digest("hex");

/** Each account owns its SDK instance, refresh state, device context and private files. */
export const createMultiAccountRuntime = async ({
  directory,
  createRuntime,
}: {
  directory: string;
  createRuntime: (directory: string) => Promise<AccountProfileRuntime>;
}): Promise<NinebotAppClient & { stopDiagnostics: () => void }> => {
  const indexPath = join(directory, "accounts.json");
  let index: AccountIndex = { version: 1, activeId: null, accounts: [] };
  let existed = false;
  try {
    const value: unknown = JSON.parse(await readFile(indexPath, "utf8"));
    if (!value || typeof value !== "object") throw new Error("Invalid account index");
    const data = value as AccountIndex;
    if (
      data.version !== 1 ||
      !Array.isArray(data.accounts) ||
      data.accounts.length > 1000 ||
      (data.activeId !== null && typeof data.activeId !== "string") ||
      data.accounts.some(
        (row) =>
          !row ||
          !opaqueId.test(row.id) ||
          (row.slot !== "root" && !opaqueId.test(row.slot)) ||
          !/^[a-f0-9]{64}$/.test(row.identity) ||
          typeof row.label !== "string" ||
          !row.label.trim() ||
          row.label.length > 100 ||
          typeof row.needsLogin !== "boolean",
      ) ||
      new Set(data.accounts.map((row) => row.id)).size !== data.accounts.length ||
      new Set(data.accounts.map((row) => row.identity)).size !== data.accounts.length ||
      new Set(data.accounts.map((row) => row.slot)).size !== data.accounts.length ||
      (data.activeId !== null && !data.accounts.some((row) => row.id === data.activeId))
    )
      throw new Error("Invalid account index");
    index = data;
    existed = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new NinebotClientError("本机账号列表无法读取，请保留文件并检查本地存储。", "upstream");
  }
  const persist = async (next: AccountIndex) => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${indexPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: "wx" });
      if (process.platform !== "win32") await chmod(temporary, 0o600);
      await rename(temporary, indexPath);
      index = next;
    } finally {
      await rm(temporary, { force: true });
    }
  };
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation);
    queue = next.catch(() => {});
    return next;
  };
  const contexts = new Map<string, AccountProfileRuntime>();
  const slotPath = (slot: string) =>
    slot === "root" ? directory : join(directory, "accounts", slot);
  const context = async (slot: string) => {
    let client = contexts.get(slot);
    if (!client) {
      client = await createRuntime(slotPath(slot));
      contexts.set(slot, client);
    }
    return client;
  };
  let activeSlot =
    index.accounts.find((row) => row.id === index.activeId)?.slot ??
    (existed ? randomUUID() : "root");
  let active = await context(activeSlot);
  let generation = 0;
  let pending: { slot: string; client: AccountProfileRuntime } | null = null;
  if (!existed && active.auth.getSession()) {
    const session = active.auth.getSession()!;
    const id = randomUUID();
    await persist({
      version: 1,
      activeId: id,
      accounts: [
        {
          id,
          slot: activeSlot,
          identity: identityOf(session.businessUid),
          label: "九号账号 1",
          needsLogin: false,
        },
      ],
    });
  }
  const state = (): SavedAccountsState => ({
    supported: true,
    activeId: index.activeId,
    accounts: index.accounts.map(({ id, label, needsLogin }): SavedAccount => ({
      id,
      label,
      needsLogin,
    })),
  });
  const discard = async (slot: string, client: AccountProfileRuntime) => {
    client.clear?.();
    await client.auth.logout();
    client.stopDiagnostics();
    contexts.delete(slot);
    if (slot !== "root") await rm(slotPath(slot), { recursive: true, force: true });
  };
  const candidate = async () => {
    if (!pending) {
      const slot = randomUUID();
      pending = { slot, client: await context(slot) };
    }
    return pending;
  };
  const commitLogin = async (
    next: { slot: string; client: AccountProfileRuntime },
    label: string | null,
  ) => {
    const session = next.client.auth.getSession();
    if (!session) throw new NinebotClientError("账号认证未完成，请重新连接。", "upstream");
    const identity = identityOf(session.businessUid);
    const existing = index.accounts.find((row) => row.identity === identity);
    const row: StoredAccount = {
      id: existing?.id ?? randomUUID(),
      identity,
      slot: next.slot,
      label: label ?? existing?.label ?? `九号账号 ${index.accounts.length + 1}`,
      needsLogin: false,
    };
    await persist({
      version: 1,
      activeId: row.id,
      accounts: existing
        ? index.accounts.map((item) => (item.id === row.id ? row : item))
        : [...index.accounts, row],
    });
    const retiredSlot = activeSlot;
    const retired = active;
    generation += 1;
    active.clear?.();
    active = next.client;
    activeSlot = next.slot;
    pending = null;
    if (existing && existing.slot !== next.slot) {
      // The new session is already committed; cleanup cannot turn a successful login into a failure.
      try {
        const previous = await context(existing.slot);
        await discard(existing.slot, previous);
      } catch {
        console.warn("Previous account session cleanup failed");
      }
    }
    if (retiredSlot !== existing?.slot && !index.accounts.some((item) => item.slot === retiredSlot))
      await discard(retiredSlot, retired).catch(() =>
        console.warn("Unused account context cleanup failed"),
      );
  };
  const login = (
    operation: (client: AccountProfileRuntime) => Promise<void>,
    label: string | null,
  ) =>
    serialize(async () => {
      const next = await candidate();
      try {
        await operation(next.client);
        await commitLogin(next, label);
      } catch (error) {
        pending = null;
        await discard(next.slot, next.client).catch(() => {});
        throw error;
      }
    });
  const read = async <T>(operation: (client: AccountProfileRuntime) => Promise<T>): Promise<T> => {
    const current = generation;
    const client = active;
    try {
      const result = await operation(client);
      if (current !== generation) throw new Error("Account changed");
      return result;
    } catch (error) {
      if (current !== generation)
        throw new NinebotClientError("账号已切换，请重新读取数据。", "upstream");
      if (error instanceof NinebotClientError && error.kind === "auth" && index.activeId) {
        const id = index.activeId;
        await serialize(async () => {
          if (
            current === generation &&
            index.accounts.some((row) => row.id === id && !row.needsLogin)
          )
            await persist({
              ...index,
              accounts: index.accounts.map((row) =>
                row.id === id ? { ...row, needsLogin: true } : row,
              ),
            });
        }).catch(() => {});
      }
      if (current !== generation)
        throw new NinebotClientError("账号已切换，请重新读取数据。", "upstream");
      throw error;
    }
  };
  const remove = async (id: string) => {
    const row = index.accounts.find((item) => item.id === id);
    if (!row) throw new NinebotClientError("该账号已不在本机列表中。", "upstream");
    const removedActive = id === index.activeId;
    const client = await context(row.slot);
    if (removedActive) {
      generation += 1;
      active.clear?.();
    }
    await discard(row.slot, client);
    await persist({
      ...index,
      activeId: removedActive ? null : index.activeId,
      accounts: index.accounts.filter((item) => item.id !== id),
    });
    if (removedActive) {
      activeSlot = randomUUID();
      active = await context(activeSlot);
    }
    return state();
  };
  return {
    supportsSmsVerification: true,
    accounts: {
      list: async () => state(),
      switch: (id) =>
        serialize(async () => {
          const row = index.accounts.find((item) => item.id === id);
          if (!row) throw new NinebotClientError("该账号已不在本机列表中。", "upstream");
          const next = await context(row.slot);
          const saved = next.auth.getSession();
          if (!saved || identityOf(saved.businessUid) !== row.identity)
            throw new NinebotClientError("该账号的本地会话已失效，请重新登录。", "upstream");
          await persist({ ...index, activeId: id });
          generation += 1;
          active.clear?.();
          active = next;
          activeSlot = row.slot;
          return state();
        }),
      remove: (id) => serialize(() => remove(id)),
    },
    login: (user, areaCode, password) =>
      login(
        (client) => client.login(user, areaCode, password),
        parseAccountProfile(
          /^\d{5,20}$/.test(user)
            ? { phone: user, areaCode }
            : user.includes("@")
              ? { email: user }
              : { username: user },
        ).maskedIdentifier,
      ),
    requestSmsCode: (phone, areaCode, validate, signal) =>
      serialize(async () => {
        if (signal?.aborted) return;
        await (await candidate()).client.requestSmsCode(phone, areaCode, validate, signal);
      }),
    loginWithSmsCode: (phone, areaCode, code) =>
      login(
        (client) => client.loginWithSmsCode(phone, areaCode, code),
        parseAccountProfile({ phone }).maskedIdentifier,
      ),
    logout: () =>
      serialize(async () => {
        if (index.activeId) await remove(index.activeId);
        else await active.logout();
      }),
    whoami: async () => {
      const current = generation;
      const result = await read((client) => client.whoami());
      const label = parseAccountProfile(result).maskedIdentifier;
      if (label)
        await serialize(async () => {
          if (current !== generation) return;
          const id = index.activeId;
          if (
            index.accounts.some((row) => row.id === id && (row.label !== label || row.needsLogin))
          )
            await persist({
              ...index,
              accounts: index.accounts.map((row) =>
                row.id === id ? { ...row, label, needsLogin: false } : row,
              ),
            });
        });
      if (current !== generation)
        throw new NinebotClientError("账号已切换，请重新读取数据。", "upstream");
      return result;
    },
    diagnostics: () => read((client) => client.diagnostics()),
    vehicles: () => read((client) => client.vehicles()),
    vehicleStatus: (sn) => read((client) => client.vehicleStatus(sn)),
    battery: (sn) => read((client) => client.battery(sn)),
    rides: (sn, month) => read((client) => client.rides(sn, month)),
    rideDetail: (sn, id) => read((client) => client.rideDetail(sn, id)),
    clear: () => active.clear?.(),
    stopDiagnostics: () => {
      for (const client of contexts.values()) client.stopDiagnostics();
    },
  };
};
