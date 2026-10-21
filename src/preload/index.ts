import { contextBridge, ipcRenderer } from "electron";
import { sdkOnlyBuild, sdkSmokeChannels } from "../shared/sdk-native-smoke.js";
import { createDesktopBridge } from "./session-bridge.js";

const bridge = createDesktopBridge((channel, ...args) => ipcRenderer.invoke(channel, ...args));
contextBridge.exposeInMainWorld("ninebot", bridge);
if (sdkOnlyBuild) {
  const isolatedWindow = globalThis as typeof globalThis & {
    addEventListener: (event: string, listener: () => void) => void;
  };
  isolatedWindow.addEventListener(sdkSmokeChannels.mounted, () => {
    void (async () => {
      if ((await ipcRenderer.invoke(sdkSmokeChannels.configure)) !== true) return;
      const runtime = await bridge.runtime.security();
      const auth = await bridge.auth.status();
      ipcRenderer.send(sdkSmokeChannels.report, {
        rendererMounted: true,
        sdkIdentity:
          runtime.ok &&
          runtime.data.version === "typescript-sdk" &&
          runtime.data.binary.status === "not-required",
        bridgeRoundTrip: runtime.ok && auth.ok,
        unauthenticated: auth.ok && auth.data.connected === false,
      });
    })().catch(() => {
      /* Main owns the fixed failure/completion state. */
    });
  });
}
