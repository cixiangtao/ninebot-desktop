import {
  createNinebotNodeAuthSessionManager,
  type NinebotAuthSessionManager,
} from "@jiuhao/ninebot-client";
import { createNinebotSdkAppClient } from "./sdk-app-client.js";
import { createSdkRuntimeDiagnostics } from "./sdk-runtime.js";
import { createCandidateVehicleReader } from "./vehicle-source.js";
import { createCandidateTelemetryReader } from "./telemetry-source.js";
import { createCandidateTravelReader } from "./travel-source.js";

/** Explicit opt-in until fresh-account online acceptance has passed. */
export const resolveDesktopAuthSource = (
  environment: Readonly<Record<string, string | undefined>>,
): "sdk" | "legacy" => (environment.NINEBOT_AUTH_SOURCE === "sdk" ? "sdk" : "legacy");

/** No legacy process or automatic fallback; all reads use this manager's fresh session. */
export const createSdkDesktopRuntime = async ({
  configDirectory,
  auth = createNinebotNodeAuthSessionManager({ directory: configDirectory }),
}: {
  configDirectory: string;
  auth?: NinebotAuthSessionManager;
}) => {
  try {
    await auth.restore();
  } catch {
    // Incomplete/corrupt legacy material cannot establish a session. Preserve files
    // and leave the login UI available; only an explicit successful login replaces it.
    console.warn("SDK local session could not be restored", { reason: "local-session" });
  }
  const sessionProvider = () => auth.ensureSession();
  const vehicleReader = createCandidateVehicleReader({ configDirectory, sessionProvider });
  const telemetryReader = createCandidateTelemetryReader({ configDirectory, sessionProvider });
  const travelReader = createCandidateTravelReader({ configDirectory, sessionProvider });
  return createNinebotSdkAppClient({
    auth,
    vehicleReader,
    telemetryReader,
    travelReader,
    diagnostics: createSdkRuntimeDiagnostics({ configDirectory, auth }),
  });
};
