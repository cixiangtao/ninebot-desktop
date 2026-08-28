import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyNineCliFailure,
  createNineCliEnvironment,
  getExpectedBinarySha256,
  isAllowedNineCliCommand,
  NineCliClient,
  resolveUvxExecutable,
  runtimePolicy,
} from "./ninecli.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("ninecli runtime policy", () => {
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
      UV_PYTHON_INSTALL_DIR: "/tmp/uv-python-dir",
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
  });

  it("pins the verified macOS arm64 and Windows x64 binary digests", () => {
    expect(getExpectedBinarySha256("darwin", "arm64")).toBe(
      "2d8aef91a74275528c995217fc7a56e5e2507d069acbd28f340e0aa573908f0a",
    );
    expect(getExpectedBinarySha256("win32", "x64")).toBe(
      "94338e423b1d5219a2f6bfeda9af34271b83814ef725220c2598676ac18d650e",
    );
    expect(getExpectedBinarySha256("win32", "arm64")).toBeNull();
    expect(getExpectedBinarySha256("linux", "x64")).toBeNull();
  });

  it("finds uvx in a Finder-safe user installation directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ninecli-uvx-test-"));
    temporaryDirectories.push(directory);
    const executableDirectory = join(directory, ".local", "bin");
    const executable = join(executableDirectory, "uvx");
    await mkdir(executableDirectory, { recursive: true });
    await writeFile(executable, "#!/bin/sh\n");
    await chmod(executable, 0o755);

    await expect(resolveUvxExecutable({ HOME: directory, PATH: "" }, "darwin")).resolves.toBe(
      executable,
    );
  });

  it("finds uvx in the Windows user installation directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ninecli-uvx-windows-test-"));
    temporaryDirectories.push(directory);
    const executableDirectory = join(directory, ".local", "bin");
    const executable = join(executableDirectory, "uvx.exe");
    await mkdir(executableDirectory, { recursive: true });
    await writeFile(executable, "windows executable placeholder");
    await chmod(executable, 0o755);

    await expect(
      resolveUvxExecutable({ USERPROFILE: directory, PATH: "C:\\missing;D:\\missing" }, "win32"),
    ).resolves.toBe(executable);
  });

  it("clears session artifacts but preserves non-token configuration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ninecli-client-test-"));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, "config.json"), "configuration");
    await writeFile(join(directory, "tokens.json"), "token");
    await writeFile(join(directory, "vehicles.json"), "vehicle-cache");
    const client = new NineCliClient(directory);

    await client.logout();

    await expect(readFile(join(directory, "config.json"), "utf8")).resolves.toBe("configuration");
    await expect(access(join(directory, "tokens.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(directory, "vehicles.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
