import { runPnpm } from "./pnpm-runner.ts";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const buildSdkOnly = (root: string) => {
  const options = {
    cwd: root,
    stdio: "inherit" as const,
    env: { ...process.env, NINEBOT_BUILD_MODE: "sdk-only" },
  };
  // Explicit steps bypass dev/preview and every legacy preparation lifecycle.
  runPnpm(["run", "build:sdk"], options);
  runPnpm(["run", "typecheck"], options);
  runPnpm(["exec", "electron-vite", "build"], options);
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  buildSdkOnly(resolve(import.meta.dirname, ".."));
