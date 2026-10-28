import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

// The production verifier uses Windows' installed PowerShell/.NET ZIP reader.
describe.skipIf(process.platform !== "win32")("Windows ZIP verification", () => {
  const roots: string[] = [];
  afterEach(() =>
    roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })),
  );

  const verify = (
    change: (files: Record<string, Uint8Array>) => void = () => {},
    transform: (data: Uint8Array) => Uint8Array = (data) => data,
  ) => {
    const root = mkdtempSync(join(tmpdir(), "ninebot-zip-"));
    roots.push(root);
    const app = join(root, "unpacked");
    const files: Record<string, Uint8Array> = {
      "韭号出行.exe": strToU8("unicode executable"),
      "resources/app.asar": strToU8("app payload"),
      "resources/runtime/ninecli/ninecli.exe": strToU8("runtime payload"),
    };
    for (const [name, data] of Object.entries(files)) {
      const path = join(app, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data);
    }
    change(files);
    const archive = join(root, "test.zip");
    writeFileSync(archive, transform(zipSync(files)));
    return () =>
      execFileSync(
        "pwsh.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-File",
          resolve("scripts/verify-windows-zip.ps1"),
          "-ArchivePath",
          archive,
          "-AppDirectory",
          app,
        ],
        { encoding: "utf8", stdio: "pipe" },
      );
  };

  it("reads the Chinese executable name and verifies every payload", () => {
    expect(verify()()).toContain("Verified 3 ZIP payloads");
  });
  it("rejects missing required entries", () => {
    expect(
      verify((files) => {
        delete files["韭号出行.exe"];
      }),
    ).toThrow(/missing required file/);
  });
  it("rejects damaged or substituted payloads", () => {
    expect(
      verify((files) => {
        files["resources/app.asar"] = strToU8("corrupt");
      }),
    ).toThrow(/payload does not match/);
  });
  it("rejects a truncated ZIP archive", () => {
    expect(verify(undefined, (data) => data.subarray(0, data.length - 30))).toThrow();
  });
  it("rejects traversal paths without extracting them", () => {
    expect(
      verify((files) => {
        files["../outside"] = strToU8("unsafe");
      }),
    ).toThrow(/Unsafe or empty/);
  });
  it("rejects unexpected files", () => {
    expect(
      verify((files) => {
        files["extra.txt"] = strToU8("extra");
      }),
    ).toThrow(/Unexpected ZIP file/);
  });
  it("rejects case-insensitive duplicate names", () => {
    expect(
      verify((files) => {
        files["resources/APP.asar"] = strToU8("app payload");
      }),
    ).toThrow(/Duplicate ZIP entry/);
  });
});
