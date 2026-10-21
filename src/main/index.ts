import { startDesktopApp } from "./desktop-main.js";
import { registerSdkRuntime } from "./runtime-sdk.js";
import { registerLegacyRuntime } from "./runtime-legacy.js";
import { resolveDesktopAuthSource } from "./sdk-desktop-runtime.js";

startDesktopApp(
  resolveDesktopAuthSource(process.env) === "sdk" ? registerSdkRuntime : registerLegacyRuntime,
);
