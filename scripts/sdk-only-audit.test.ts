import { describe, expect, it } from "vitest";
import { assertSdkOnlyArchive } from "./sdk-only-audit.ts";

const files = [
  "/package.json",
  "/THIRD_PARTY_NOTICES.md",
  "/out/main/index.js",
  "/out/preload/index.cjs",
  "/out/renderer/index.html",
  "/out/renderer/recovery.html",
  "/out/renderer/recovery.js",
  "/node_modules/@jiuhao/ninebot-client/dist/index.js",
];
const metadata = { ninebotRuntime: "sdk-only", main: "./out/main/index.js" };
const main = 'export const packagedRuntime = "sdk-only-v1";';
describe("SDK-only ASAR audit rejects contaminated or incorrectly selected artifacts", () => {
  it("accepts a complete SDK artifact", () =>
    expect(() => assertSdkOnlyArchive(files, metadata, main)).not.toThrow());
  it.each([
    "/runtime/ninecli/ninecli",
    "/ninecli.exe",
    "/.env",
    "/auth-session.json",
    "/tokens.json",
    "/vehicle-cache.json.account",
  ])("rejects forbidden archive file %s", (file) => {
    expect(() => assertSdkOnlyArchive([...files, file], metadata, main)).toThrow();
  });
  it.each(['import "node:child_process"', "new NineCliClient()", "prepare-ninecli-runtime"])(
    "rejects legacy execution code %s",
    (code) => {
      expect(() => assertSdkOnlyArchive(files, metadata, `${main}\n${code}`)).toThrow();
    },
  );
  it("rejects a mismatched manifest, entry or missing SDK dependency", () => {
    expect(() =>
      assertSdkOnlyArchive(files, { ...metadata, ninebotRuntime: "legacy" }, main),
    ).toThrow();
    expect(() => assertSdkOnlyArchive(files, metadata, "legacy entry")).toThrow();
    expect(() => assertSdkOnlyArchive(files.slice(0, -1), metadata, main)).toThrow();
  });
});
