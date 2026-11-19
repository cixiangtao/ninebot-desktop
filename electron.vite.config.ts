import { resolve } from "node:path";
import { resolveBuildMode } from "./src/shared/build-mode.ts";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const sdkOnly = resolveBuildMode(process.env.NINEBOT_BUILD_MODE) === "sdk-only";
const outputRoot = sdkOnly ? "build/generated/sdk-only/out" : "out";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: `${outputRoot}/main`,
      rollupOptions: {
        input: { index: resolve(sdkOnly ? "src/main/index.sdk.ts" : "src/main/index.ts") },
      },
    },
  },
  preload: {
    define: { SDK_ONLY_BUILD_FLAG: JSON.stringify(sdkOnly) },
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: `${outputRoot}/preload`,
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          "sms-verification": resolve("src/preload/sms-verification.ts"),
        },
        output: {
          entryFileNames: "[name].cjs",
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    define: { SDK_ONLY_BUILD_FLAG: JSON.stringify(sdkOnly) },
    build: { outDir: `${outputRoot}/renderer` },
    plugins: [react(), tailwindcss()],
  },
});
