import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createFileNinebotAuthSessionStore,
  type FileNinebotAuthSessionStoreOptions,
} from "./session-store-node.ts";

const directories: string[] = [];

const createStore = async (overrides: Partial<FileNinebotAuthSessionStoreOptions> = {}) => {
  const directory = await mkdtemp(join(tmpdir(), "ninebot-auth-"));
  directories.push(directory);
  return {
    directory,
    store: createFileNinebotAuthSessionStore({ directory, ...overrides }),
  };
};

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

describe("file-backed Ninebot auth session store", () => {
  it("writes and reads the new session format atomically", async () => {
    const { directory, store } = await createStore();
    const session = { accessToken: "token", businessUid: "uid", expiresAtMs: 1234 };

    await store.save(session);

    await expect(store.load()).resolves.toEqual(session);
    await expect(readFile(join(directory, "auth-session.json"), "utf8")).resolves.toContain(
      '"accessToken":"token"',
    );
    if (process.platform !== "win32") {
      await expect(stat(join(directory, "auth-session.json"))).resolves.toMatchObject({
        mode: 0o100600,
      });
    }
  });

  it("reads legacy ninecli token fields without changing the legacy file", async () => {
    const { directory, store } = await createStore();
    const legacy = '{"access_token":"legacy-token","business_uid":"legacy-uid"}';
    await writeFile(join(directory, "tokens.json"), legacy);

    await expect(store.load()).resolves.toEqual({
      accessToken: "legacy-token",
      businessUid: "legacy-uid",
    });
    await expect(readFile(join(directory, "tokens.json"), "utf8")).resolves.toBe(legacy);
  });

  it("normalizes legacy access-token validity for refresh-aware restore", async () => {
    const { directory, store } = await createStore();
    await writeFile(
      join(directory, "tokens.json"),
      JSON.stringify({
        access_token: "legacy-token",
        business_uid: "legacy-uid",
        accessTokenValidity: "1790735062000",
      }),
    );

    await expect(store.load()).resolves.toMatchObject({
      accessToken: "legacy-token",
      businessUid: "legacy-uid",
      expiresAtMs: 1_790_735_062_000,
    });
  });

  it("keeps legacy uuid and refresh metadata for business bootstrap", async () => {
    const { directory, store } = await createStore();
    await writeFile(
      join(directory, "tokens.json"),
      JSON.stringify({
        access_token: "legacy-token",
        business_uid: "legacy-uid",
        uuid: "legacy-uuid",
        refresh_token: "legacy-refresh",
      }),
    );

    await expect(store.load()).resolves.toMatchObject({
      accessToken: "legacy-token",
      businessUid: "legacy-uid",
      uuid: "legacy-uuid",
      refreshToken: "legacy-refresh",
    });
  });

  it("clears only the new session file", async () => {
    const { directory, store } = await createStore();
    await store.save({ accessToken: "token", businessUid: "uid" });
    await writeFile(
      join(directory, "tokens.json"),
      '{"access_token":"legacy","business_uid":"legacy"}',
    );

    await store.clear();

    await expect(store.load()).resolves.toEqual({
      accessToken: "legacy",
      businessUid: "legacy",
    });
    await expect(readFile(join(directory, "tokens.json"), "utf8")).resolves.toContain(
      '"access_token":"legacy"',
    );
  });
});
