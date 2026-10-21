import { app } from "electron";
import { createFileRuntimeDiagnostics } from "./runtime-diagnostics.js";
import { registerIpcHandlers } from "./ipc.js";
import { createSdkDesktopRuntime } from "./sdk-desktop-runtime.js";

export const registerSdkRuntime = async (configDirectory: string) => {
  const diagnostics = createFileRuntimeDiagnostics({
    directory: configDirectory,
    enabled: process.env.NINEBOT_RUNTIME_DIAGNOSTICS === "1",
  });
  const client = await createSdkDesktopRuntime({
    configDirectory,
    onDiagnostic: diagnostics.record,
  });
  registerIpcHandlers(client, client, client, client, { onDiagnostic: diagnostics.record });
  app.on("before-quit", () => {
    client.stopDiagnostics();
    client.clear?.();
    void diagnostics.flush();
  });
};
