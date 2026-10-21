import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { buildSdkOnly } from "./build-sdk-only.ts";
import { pnpmCommand } from "./pnpm-runner.ts";
vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
afterEach(() => vi.clearAllMocks());
describe("SDK-only build never invokes a legacy preparation lifecycle", () => {
  it("uses explicit SDK, types and Vite steps with a private build mode", () => {
    buildSdkOnly("/synthetic");
    const calls = vi.mocked(execFileSync).mock.calls;
    expect(calls).toHaveLength(3);
    const argumentsOnly = calls.map(([, args]) => args as string[]);
    expect(argumentsOnly.map((args) => args.slice(-2))).toEqual([
      ["run", "build:sdk"],
      ["run", "typecheck"],
      ["electron-vite", "build"],
    ]);
    expect(JSON.stringify(argumentsOnly)).not.toContain("prepare-ninecli");
    expect(JSON.stringify(argumentsOnly)).not.toContain("prepare:ninecli");
    for (const [, , options] of calls) {
      expect(options?.cwd).toBe("/synthetic");
      expect(options?.env?.NINEBOT_BUILD_MODE).toBe("sdk-only");
    }
  });
  it("builds a Windows command without a shell or cmd interpolation", () => {
    const path = "C:\\Synthetic & Private\\pnpm.cjs";
    expect(pnpmCommand(["exec", "electron-builder", "--publish", "never"], "win32", path)).toEqual({
      executable: process.execPath,
      args: [path, "exec", "electron-builder", "--publish", "never"],
    });
    expect(() => pnpmCommand([], "win32", "")).toThrow(/pnpm run/);
  });
});
