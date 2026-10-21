import { resolve } from "node:path";
import type { Configuration } from "electron-builder";

export const sdkOnlyPaths = (root: string) => ({
  out: resolve(root, "build/generated/sdk-only/out"),
  config: resolve(root, "build/generated/sdk-only/electron-builder.json"),
  release: resolve(root, "release/sdk-only"),
});

/** A complete independent builder config; never inherit the package's resource arrays. */
export const sdkOnlyPackageConfig = (root: string, base: Configuration): Configuration => ({
  ...base,
  extends: null,
  directories: { ...base.directories, output: sdkOnlyPaths(root).release },
  files: [
    { from: sdkOnlyPaths(root).out, to: "out", filter: ["**/*"] },
    "package.json",
    "THIRD_PARTY_NOTICES.md",
  ],
  extraResources: [],
  extraFiles: [],
  extraMetadata: { ninebotRuntime: "sdk-only" },
  electronDist: resolve(root, "node_modules/electron/dist"),
  npmRebuild: false,
  publish: null,
  mac: {
    ...base.mac,
    target: ["dir"],
    identity: "-",
    hardenedRuntime: false,
    notarize: false,
    artifactName: "ninebot-desktop-${version}-sdk-only-mac-${arch}.${ext}",
  },
  win: {
    ...base.win,
    target: ["dir"],
    artifactName: "ninebot-desktop-${version}-sdk-only-win-${arch}.${ext}",
  },
});
