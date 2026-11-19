import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  KeychainCredentialError,
  parseKeychainSelector,
  readKeychainCredentials,
} from "./auth-keychain.ts";

const selector = {
  store: "login",
  kind: "internet",
  server: "ninebot.com",
  protocol: "https",
  account: "fake-account",
};
const secret = "fake-password-for-tests-only";
const confirm = async () => {};

describe("exact Keychain selector", () => {
  it("accepts only the scoped login item and preserves exact attributes", () => {
    expect(parseKeychainSelector(selector)).toEqual({ ...selector, areaCode: "86" });
    expect(
      parseKeychainSelector({
        store: "login",
        kind: "generic",
        service: "ninebot.com",
        account: "fake",
      }),
    ).toEqual({
      store: "login",
      kind: "generic",
      service: "ninebot.com",
      account: "fake",
      areaCode: "86",
    });
    expect(parseKeychainSelector({ ...selector, path: "/", port: 443, areaCode: "+86" })).toEqual({
      ...selector,
      path: "/",
      port: 443,
      areaCode: "+86",
    });
  });
  it.each([
    null,
    [],
    {},
    { ...selector, store: "passwords" },
    { ...selector, server: "other.example" },
    { ...selector, server: "www.ninebot.com" },
    { ...selector, server: "*.ninebot.com" },
    { ...selector, account: "" },
    { ...selector, account: " fake " },
    { ...selector, account: "fake\naccount" },
    { ...selector, protocol: "ftp" },
    { ...selector, path: "relative" },
    { ...selector, port: true },
    { ...selector, port: -1 },
    { ...selector, port: 1.5 },
    { ...selector, areaCode: "invalid" },
    { ...selector, password: secret },
  ])("rejects unsupported or broad input without echoing any values", (value) => {
    try {
      parseKeychainSelector(value);
      expect.fail("must reject");
    } catch (error) {
      expect(error).toBeInstanceOf(KeychainCredentialError);
      expect(String(error)).toBe("KeychainCredentialError: keychain-invalid-input");
    }
  });
});

describe("private credential handoff using fake helpers", () => {
  it("confirms before helper execution, passes no password in the request, and wipes buffers", async () => {
    const order: string[] = [];
    let requestBuffer: Buffer | undefined;
    const payload = Buffer.from(JSON.stringify({ password: secret }));
    const result = await readKeychainCredentials(selector, {
      confirm: async () => {
        order.push("confirm");
      },
      run: async (request) => {
        order.push("helper");
        requestBuffer = request;
        expect(JSON.parse(request.toString())).toEqual({ ...selector, areaCode: "86" });
        expect(request.toString()).not.toContain(secret);
        return { code: 0, payload };
      },
    });
    expect(order).toEqual(["confirm", "helper"]);
    expect(result).toEqual({ user: "fake-account", password: secret, areaCode: "86" });
    expect(payload.every((byte) => byte === 0)).toBe(true);
    expect(requestBuffer?.every((byte) => byte === 0)).toBe(true);
  });
  it("does not call the helper after cancellation or invalid selection", async () => {
    const run = vi.fn();
    await expect(
      readKeychainCredentials(selector, {
        confirm: async () => {
          throw new KeychainCredentialError("keychain-cancelled");
        },
        run,
      }),
    ).rejects.toThrow("keychain-cancelled");
    await expect(
      readKeychainCredentials({ ...selector, account: "" }, { confirm, run }),
    ).rejects.toThrow("keychain-invalid-input");
    expect(run).not.toHaveBeenCalled();
  });
  it.each([
    [20, "keychain-not-found"],
    [21, "keychain-ambiguous"],
    [22, "keychain-cancelled"],
    [23, "keychain-denied"],
    [24, "keychain-unavailable"],
    [25, "keychain-invalid-input"],
    [26, "keychain-invalid-response"],
    [77, "keychain-unavailable"],
    [null, "keychain-unavailable"],
  ])("uses only fixed reasons for helper exit %s", async (code, reason) => {
    const payload = Buffer.from(secret);
    await expect(
      readKeychainCredentials(selector, {
        confirm,
        run: async () => ({ code: code as number | null, payload }),
      }),
    ).rejects.toThrow(reason as string);
    expect(payload.every((byte) => byte === 0)).toBe(true);
  });
  it.each([
    secret,
    "{}",
    '{"password":""}',
    '{"password":1}',
    JSON.stringify({ password: secret, token: secret }),
    "x".repeat(16_385),
  ])("does not expose malformed or excessive helper output", async (body) => {
    const payload = Buffer.from(body);
    await expect(
      readKeychainCredentials(selector, { confirm, run: async () => ({ code: 0, payload }) }),
    ).rejects.toThrow("keychain-invalid-response");
    expect(payload.every((byte) => byte === 0)).toBe(true);
  });
  it("stops an aborted operation before the helper and rejects invalid UTF-8", async () => {
    const run = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(
      readKeychainCredentials(selector, { confirm, run, signal: controller.signal }),
    ).rejects.toThrow("keychain-cancelled");
    expect(run).not.toHaveBeenCalled();
    const payload = Buffer.from([0xff]);
    await expect(
      readKeychainCredentials(selector, { confirm, run: async () => ({ code: 0, payload }) }),
    ).rejects.toThrow("keychain-invalid-response");
    expect(payload[0]).toBe(0);
  });
  it("does not expose injected helper or confirmation errors", async () => {
    await expect(
      readKeychainCredentials(selector, {
        confirm,
        run: async () => {
          throw new Error(secret);
        },
      }),
    ).rejects.toThrow("keychain-invalid-response");
  });
});

describe("CLI rejects fake selectors before accessing Keychain", () => {
  const cli = fileURLToPath(new URL("auth-acceptance.ts", import.meta.url));
  it.each([
    ["not-json", "keychain-invalid-input"],
    [JSON.stringify({ ...selector, server: "other.example" }), "keychain-invalid-input"],
    [JSON.stringify({ ...selector, password: secret }), "keychain-invalid-input"],
  ])("prints only the fixed failure reason for invalid stdin", (input, reason) => {
    const result = spawnSync(process.execPath, [cli, "--auth-only", "--credentials-keychain"], {
      input,
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({ outcome: "failed", phase: "credentials", reason });
    expect(result.stdout).not.toContain(secret);
  });
});
