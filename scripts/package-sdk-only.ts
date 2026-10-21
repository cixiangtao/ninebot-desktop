import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Configuration } from "electron-builder";
import { runPnpm } from "./pnpm-runner.ts";
import { buildSdkOnly } from "./build-sdk-only.ts";
import { sdkOnlyPackageConfig, sdkOnlyPaths } from "./sdk-only-config.ts";
import { verifySdkOnlyPackage } from "./sdk-only-audit.ts";

const root = resolve(import.meta.dirname, "..");
const platform = process.argv.find((arg) => arg.startsWith("--platform="))?.slice(11);
if (platform !== "darwin" && platform !== "win32")
  throw new Error("Choose SDK-only --platform=darwin or win32");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
  build: Configuration;
};
const config = sdkOnlyPackageConfig(root, pkg.build);
const paths = sdkOnlyPaths(root);
if (process.argv.includes("--plan")) {
  console.log(
    JSON.stringify({ platform, config, legacyPreparation: false, mode: "sdk-only" }, null, 2),
  );
} else {
  if (platform !== process.platform)
    throw new Error(
      "SDK-only local packaging requires its target OS; use --plan for static inspection",
    );
  // Use the installed pinned Electron distribution. No Electron/wheel download step.
  await access(
    join(
      root,
      platform === "darwin"
        ? "node_modules/electron/dist/Electron.app"
        : "node_modules/electron/dist/electron.exe",
    ),
  );
  buildSdkOnly(root);
  await mkdir(dirname(paths.config), { recursive: true });
  await writeFile(paths.config, JSON.stringify(config, null, 2));
  runPnpm(
    [
      "exec",
      "electron-builder",
      "--config",
      paths.config,
      platform === "darwin" ? "--mac" : "--win",
      "dir",
      platform === "darwin" ? "--arm64" : "--x64",
      "--publish",
      "never",
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
    },
  );
  const app = join(
    paths.release,
    platform === "darwin" ? "mac-arm64/韭号出行.app" : "win-unpacked",
  );
  console.log(JSON.stringify(await verifySdkOnlyPackage(root, app, platform), null, 2));
  execFileSync(
    process.execPath,
    [
      "--experimental-vm-modules",
      "--experimental-import-meta-resolve",
      join(root, "scripts/qa-sdk-only-package.mjs"),
      `--app=${app}`,
    ],
    { cwd: root, stdio: "inherit" },
  );
}
