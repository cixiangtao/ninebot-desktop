import { configureSdkNativeSmoke } from "./sdk-native-smoke.js";
import { startDesktopApp } from "./desktop-main.js";
import { registerSdkRuntime } from "./runtime-sdk.js";

// This entry has no legacy import or environment switch back to a subprocess.
export const packagedRuntime = "sdk-only-v1";
configureSdkNativeSmoke();
startDesktopApp(registerSdkRuntime);
