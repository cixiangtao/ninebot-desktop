import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("The Keychain helper requires macOS");
const root = new URL("../", import.meta.url);
const output = new URL("build/generated/auth-keychain/", root);
await mkdir(output, { recursive: true, mode: 0o700 });
const result = spawnSync(
  "/usr/bin/swiftc",
  [
    "-module-cache-path",
    fileURLToPath(new URL("module-cache/", output)),
    "-O",
    fileURLToPath(new URL("scripts/native/auth-keychain.swift", root)),
    "-o",
    fileURLToPath(new URL("auth-keychain", output)),
  ],
  { stdio: "inherit" },
);
if (result.error || result.status !== 0) throw new Error("Keychain helper compilation failed");
console.log("Built read-only Keychain helper; no Keychain item was accessed.");
