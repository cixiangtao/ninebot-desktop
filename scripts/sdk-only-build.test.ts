import { readFile } from "node:fs/promises";
import { sdkOnlyPackageConfig, sdkOnlyPaths } from "./sdk-only-config.ts";
import { resolveBuildMode } from "../src/shared/build-mode.ts";
import { describe, expect, it } from "vitest";

describe("SDK-only opt-in build contract", () => {
  it("has an explicit packaging command without changing legacy defaults", async () => {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.scripts["package:sdk:mac:dir"]).toBe(
      "node scripts/package-sdk-only.ts --platform=darwin",
    );
    expect(pkg.scripts["package:mac:dir"]).toContain("prepare:ninecli-runtime");
    expect(pkg.build.extraResources[0].filter).toContain("ninecli/ninecli");
  });
  it("rejects ambiguous modes and preserves the ordinary default", () => {
    expect(resolveBuildMode(undefined)).toBe("legacy");
    expect(resolveBuildMode("legacy")).toBe("legacy");
    expect(resolveBuildMode("sdk-only")).toBe("sdk-only");
    expect(() => resolveBuildMode("sdk")).toThrow(/mode/i);
  });
  it("isolates resources and artifacts even when the base config includes legacy files", () => {
    const base = {
      files: ["out/**"],
      extraResources: ["legacy"],
      extraFiles: ["ninecli"],
      mac: { notarize: true },
      directories: { output: "release" },
    };
    const config = sdkOnlyPackageConfig("/synthetic", base);
    expect(config.extraResources).toEqual([]);
    expect(config.extraFiles).toEqual([]);
    expect(config.extends).toBeNull();
    expect(config.extraMetadata).toEqual({ ninebotRuntime: "sdk-only" });
    expect(config.directories?.output).toBe(sdkOnlyPaths("/synthetic").release);
    expect(config.files).toContainEqual({
      from: sdkOnlyPaths("/synthetic").out,
      to: "out",
      filter: ["**/*"],
    });
    expect(config.mac).toMatchObject({ notarize: false, identity: "-", target: ["dir"] });
    expect(config.win).toMatchObject({ target: ["dir"] });
    expect(config.publish).toBeNull();
    expect(base.extraResources).toEqual(["legacy"]);
  });
});
