import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyNineCliFailure,
  assertNineCliSmsSent,
  createNineCliEnvironment,
  getBundledNineCliBinaryPath,
  getExpectedBinarySha256,
  isAllowedNineCliCommand,
  NineCliClient,
  NineCliError,
  runtimePolicy,
} from "./ninecli.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("ninecli runtime policy", () => {
  it.each(["password", "sms"] as const)(
    "requires complete Business material after native %s exit 0",
    async (method) => {
      const directory = await mkdtemp(join(tmpdir(), "ninecli-auth-completion-"));
      temporaryDirectories.push(directory);
      const client = new NineCliClient(directory, "unused-synthetic-binary");
      const run = vi
        .spyOn(client as unknown as { run: (...args: unknown[]) => Promise<string> }, "run")
        .mockResolvedValue("synthetic exit 0");
      const tokens = {
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        uuid: "synthetic-uuid",
      };
      const login = () =>
        method === "password"
          ? client.login("synthetic", "86", "synthetic")
          : client.loginWithSmsCode("15500000000", "86", "123456");
      await writeFile(join(directory, "tokens.json"), JSON.stringify(tokens));
      await expect(login()).rejects.toMatchObject({ kind: "auth" });
      expect(JSON.parse(await readFile(join(directory, "tokens.json"), "utf8"))).toEqual(tokens);
      await writeFile(
        join(directory, "tokens.json"),
        JSON.stringify({ ...tokens, business_uid: "synthetic-business" }),
      );
      await expect(login()).resolves.toBeUndefined();
      expect(run).toHaveBeenCalledTimes(2);
    },
  );

  it("never calls whoami for absent or partial native sessions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ninecli-auth-status-"));
    temporaryDirectories.push(directory);
    const client = new NineCliClient(directory, "unused-synthetic-binary");
    const run = vi
      .spyOn(
        client as unknown as {
          runJsonWithUpstreamRetries: (...args: unknown[]) => Promise<unknown>;
        },
        "runJsonWithUpstreamRetries",
      )
      .mockResolvedValue({ username: "synthetic" });
    await expect(client.whoami()).rejects.toMatchObject({ kind: "auth" });
    await writeFile(join(directory, "tokens.json"), '{"access_token":"synthetic"}');
    await expect(client.whoami()).rejects.toMatchObject({ kind: "auth" });
    expect(run).not.toHaveBeenCalled();
    await writeFile(
      join(directory, "tokens.json"),
      JSON.stringify({
        access_token: "synthetic",
        refresh_token: "synthetic",
        uuid: "synthetic",
        business_uid: "synthetic",
      }),
    );
    await expect(client.whoami()).resolves.toEqual({ username: "synthetic" });
  });
  it("checks structured SMS results even when the process reports success", async () => {
    const client = new NineCliClient("unused-synthetic-directory", "unused-synthetic-binary");
    const run = vi.spyOn(
      client as unknown as { run: (...args: unknown[]) => Promise<string> },
      "run",
    );
    run.mockResolvedValue(
      'SMS sent to synthetic phone.\n{\n"resultCode":90202,"resultDesc":"send code need verify","data":{}\n}',
    );
    await expect(client.requestSmsCode("15500000000", "86")).rejects.toMatchObject({
      kind: "verification",
    });
    expect(run).toHaveBeenCalledWith(
      "login-code",
      ["--area", "86", "--phone", "15500000000"],
      true,
    );
    run.mockResolvedValue('SMS sent to synthetic phone.\n{\n"resultCode":90000,"data":{}\n}');
    await expect(client.requestSmsCode("15500000000", "86")).resolves.toBeUndefined();
  });

  it.each([90000, "90000"])("accepts explicit SMS success %s", (resultCode) => {
    expect(() => assertNineCliSmsSent(JSON.stringify({ resultCode, data: {} }))).not.toThrow();
  });

  it.each([
    "SMS sent to synthetic phone",
    "not-json",
    "{}",
    '{"resultCode":0}',
    '{"resultCode":null}',
    '{"resultCode":true}',
    '{"resultCode":2,"resultDesc":"synthetic-secret"}',
    '{"resultCode":90000,"code":2}',
    '{"resultCode":90000,"resultDesc":{}}',
    '{"resultCode":90000}\n{"resultCode":90202}',
  ])("fails closed without leaking an unconfirmed SMS response", (raw) => {
    expect(() => assertNineCliSmsSent(raw)).toThrow(NineCliError);
    try {
      assertNineCliSmsSent(raw);
    } catch (error) {
      expect(String(error)).not.toContain("synthetic-secret");
    }
  });
  it("passes only the minimal environment and keeps proxy connectivity", () => {
    const environment = createNineCliEnvironment({
      PATH: "/usr/bin",
      HOME: "/Users/example",
      USERPROFILE: "C:\\Users\\example",
      LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local",
      SYSTEMROOT: "C:\\Windows",
      TEMP: "C:\\Temp",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      UV_PYTHON_INSTALL_DIR: "/tmp/uv-python-dir",
      NINEBOT_SECRET: "must-not-leak",
      AWS_SECRET_ACCESS_KEY: "must-not-leak",
    });

    expect(environment).toEqual({
      PATH: "/usr/bin",
      HOME: "/Users/example",
      USERPROFILE: "C:\\Users\\example",
      LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local",
      SYSTEMROOT: "C:\\Windows",
      TEMP: "C:\\Temp",
      HTTPS_PROXY: "http://127.0.0.1:7890",
    });
  });

  it("only allows the fixed application command set", () => {
    expect(isAllowedNineCliCommand("whoami")).toBe(true);
    expect(isAllowedNineCliCommand("vehicles")).toBe(true);
    expect(isAllowedNineCliCommand("travel")).toBe(true);
    expect(isAllowedNineCliCommand("status")).toBe(true);
    expect(isAllowedNineCliCommand("battery")).toBe(true);
    expect(isAllowedNineCliCommand("login")).toBe(true);
    expect(isAllowedNineCliCommand("login-code")).toBe(true);
    expect(isAllowedNineCliCommand("unlock")).toBe(false);
    expect(isAllowedNineCliCommand("control")).toBe(false);
  });

  it("declares the session cache as memory-only and free of raw responses", () => {
    expect(runtimePolicy.sessionCache).toEqual({
      storage: "memory-only",
      rawResponsesStored: false,
      persistsAcrossRestarts: false,
      manualRefreshBypasses: true,
    });
  });

  it("classifies the upstream SMS human-verification challenge without exposing raw output", () => {
    const error = classifyNineCliFailure(
      "",
      'server code=<nil> resultCode=90202 desc="send code need verify"',
    );

    expect(error.kind).toBe("verification");
    expect(error.message).toContain("人机验证");
    expect(error.message).not.toContain("90202");
    expect(error.message).not.toContain("改用密码登录");
  });

  it("pins the verified macOS arm64 and Windows x64 binary digests", () => {
    expect(getExpectedBinarySha256("darwin", "arm64")).toBe(
      "70ba65c63a09373a6eab63cf96b80cd06fff2fd107dff63e884efafb9b31352c",
    );
    expect(getExpectedBinarySha256("win32", "x64")).toBe(
      "94338e423b1d5219a2f6bfeda9af34271b83814ef725220c2598676ac18d650e",
    );
    expect(getExpectedBinarySha256("win32", "arm64")).toBeNull();
    expect(getExpectedBinarySha256("linux", "x64")).toBeNull();
  });

  it("resolves only the generated or packaged runtime location", () => {
    expect(
      getBundledNineCliBinaryPath({
        appPath: "/workspace",
        isPackaged: false,
        resourcesPath: "/ignored",
        platform: "darwin",
      }),
    ).toBe(join("/workspace", "build", "generated", "runtime", "ninecli", "ninecli"));
    expect(
      getBundledNineCliBinaryPath({
        appPath: "C:\\workspace",
        isPackaged: true,
        resourcesPath: "C:\\app\\resources",
        platform: "win32",
      }),
    ).toBe(join("C:\\app\\resources", "runtime", "ninecli", "ninecli.exe"));
  });

  it("clears session artifacts but preserves non-token configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ninecli-client-test-"));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, "config.json"), "configuration");
    await writeFile(join(directory, "tokens.json"), "token");
    await writeFile(join(directory, "vehicles.json"), "vehicle-cache");
    const client = new NineCliClient(directory, join(directory, "ninecli"));

    await client.logout();

    await expect(readFile(join(directory, "config.json"), "utf8")).resolves.toBe("configuration");
    await expect(access(join(directory, "tokens.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(directory, "vehicles.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
