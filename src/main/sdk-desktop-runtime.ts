import {
  createNinebotNodeAuthSessionManager,
  type NinebotAuthSessionManager,
} from "@jiuhao/ninebot-client/node";
import {
  createNinebotSdkAppClient,
  normalizeSdkAuthError,
  type NinebotSdkAppClientOptions,
} from "./sdk-app-client.js";
import { createSdkRuntimeDiagnostics } from "./sdk-runtime.js";
import { createCandidateVehicleReader } from "./vehicle-source.js";
import { createCandidateTelemetryReader } from "./telemetry-source.js";
import { emitRuntimeDiagnostic, type RuntimeDiagnosticObserver } from "./runtime-diagnostics.js";
import { createCandidateTravelReader } from "./travel-source.js";

/** Explicit opt-in until desktop acceptance and the default-runtime switch are approved. */
export const resolveDesktopAuthSource = (
  environment: Readonly<Record<string, string | undefined>>,
): "sdk" | "legacy" => (environment.NINEBOT_AUTH_SOURCE === "sdk" ? "sdk" : "legacy");

/** No legacy process or automatic fallback; all reads use this manager's fresh session. */
export const createSdkDesktopRuntime = async ({
  configDirectory,
  auth = createNinebotNodeAuthSessionManager({
    directory: configDirectory,
    legacySession: "ignore",
  }),
  readers = {},
  onDiagnostic,
}: {
  configDirectory: string;
  auth?: NinebotAuthSessionManager;
  onDiagnostic?: RuntimeDiagnosticObserver;
  readers?: Partial<
    Pick<NinebotSdkAppClientOptions, "vehicleReader" | "telemetryReader" | "travelReader">
  >;
}) => {
  const stopDiagnostics = onDiagnostic
    ? auth.observeDiagnostics((event) =>
        emitRuntimeDiagnostic(onDiagnostic, { category: "auth", event }),
      )
    : () => {};
  try {
    await auth.restore();
  } catch {
    // Incomplete/corrupt SDK material cannot establish a session. Preserve files
    // and leave the login UI available; only an explicit successful login replaces it.
    console.warn("SDK local session could not be restored", { reason: "local-session" });
  }
  const sessionProvider = async () => {
    try {
      return await auth.ensureSession();
    } catch (error) {
      throw normalizeSdkAuthError(error);
    }
  };
  const vehicleReader =
    readers.vehicleReader ?? createCandidateVehicleReader({ configDirectory, sessionProvider });
  const telemetryReader =
    readers.telemetryReader ?? createCandidateTelemetryReader({ configDirectory, sessionProvider });
  const travelReader =
    readers.travelReader ?? createCandidateTravelReader({ configDirectory, sessionProvider });
  const client = createNinebotSdkAppClient({
    auth,
    vehicleReader,
    telemetryReader,
    travelReader,
    diagnostics: createSdkRuntimeDiagnostics({ configDirectory, auth }),
    onProfileFailure: (failure) =>
      emitRuntimeDiagnostic(onDiagnostic, { category: "profile-failure", failure }),
  });
  return Object.assign(client, { stopDiagnostics });
};
