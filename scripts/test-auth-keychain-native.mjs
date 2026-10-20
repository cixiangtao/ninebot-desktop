// Compile and execute only a fixture build whose Keychain API calls are compiled out.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("Native fixture tests require macOS");
const directory = await mkdtemp(join(tmpdir(), "ninebot-keychain-fixtures-"));
try {
  const binary = join(directory, "fake-keychain");
  const compiled = spawnSync(
    "/usr/bin/swiftc",
    [
      "-D",
      "KEYCHAIN_HELPER_TESTING",
      "-module-cache-path",
      join(directory, "modules"),
      fileURLToPath(new URL("native/auth-keychain.swift", import.meta.url)),
      "-o",
      binary,
    ],
    { stdio: "inherit" },
  );
  assert.equal(compiled.status, 0, "fixture compilation");
  const run = (selector, privatePipe = true) =>
    new Promise((resolve, reject) => {
      const child = spawn(binary, [], {
        stdio: ["pipe", "pipe", "pipe", privatePipe ? "pipe" : "ignore"],
      });
      const chunks = [],
        out = [],
        err = [];
      child.on("error", reject);
      child.stdin.on("error", () => {});
      child.stdout.on("data", (chunk) => out.push(chunk));
      child.stderr.on("data", (chunk) => err.push(chunk));
      if (privatePipe) child.stdio[3].on("data", (chunk) => chunks.push(chunk));
      child.on("close", (code) => {
        assert.equal(Buffer.concat(out).length, 0, "no stdout");
        assert.equal(Buffer.concat(err).length, 0, "no stderr");
        resolve({ code, payload: Buffer.concat(chunks).toString() });
      });
      child.stdin.end(JSON.stringify(selector));
    });
  const base = {
    store: "login",
    kind: "internet",
    server: "ninebot.com",
    protocol: "https",
    account: "success",
  };
  assert.deepEqual(await run(base), { code: 0, payload: '{"password":"fake-password-only"}' });
  assert.equal(
    (await run({ store: "login", kind: "generic", service: "ninebot.com", account: "success" }))
      .code,
    0,
  );
  await Promise.all(
    [
      ["missing", 20],
      ["duplicate", 21],
      ["cancelled", 22],
      ["denied", 23],
      ["mismatch", 26],
      ["changed", 26],
      ["invalid-utf8", 26],
    ].map(async ([account, code]) => {
      assert.deepEqual(await run({ ...base, account }), { code, payload: "" });
    }),
  );
  await Promise.all(
    [
      { ...base, server: "other.example" },
      { ...base, store: "passwords" },
      { ...base, account: "" },
      { ...base, password: "fake" },
      { ...base, port: true },
    ].map(async (input) => {
      assert.deepEqual(await run(input), { code: 25, payload: "" });
    }),
  );
  assert.deepEqual(await run(base, false), { code: 25, payload: "" });
  console.log("Native fixture checks passed; no real Keychain API was called.");
  const terminal = spawnSync(
    "/usr/bin/python3",
    [fileURLToPath(new URL("test-auth-keychain-terminal.py", import.meta.url)), process.execPath],
    { stdio: "inherit", timeout: 40_000 },
  );
  assert.equal(terminal.status, 0, "synthetic terminal confirmation");
} finally {
  await rm(directory, { recursive: true, force: true });
}
