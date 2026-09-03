import { basename } from "node:path";
import type { NinebotAuthSessionManager } from "@jiuhao/ninebot-client";
import { candidateRequestTimeoutMs } from "./candidate-client.js";
import { resolveCandidateSource } from "./data-source.js";
import type { RuntimeSecurityStatus } from "../shared/contracts.js";

/** Builds renderer-safe diagnostics for the pure SDK runtime. */
export const createSdkRuntimeDiagnostics =
  ({ configDirectory, auth }: { configDirectory: string; auth: NinebotAuthSessionManager }) =>
  async (): Promise<RuntimeSecurityStatus> => ({
    version: "typescript-sdk",
    candidate: {
      requestTimeoutMs: candidateRequestTimeoutMs,
      domains: {
        vehicle: resolveCandidateSource(process.env, "vehicle"),
        telemetry: resolveCandidateSource(process.env, "telemetry"),
        travel: resolveCandidateSource(process.env, "travel"),
      },
    },
    binary: {
      status: "unsupported",
      sha256: null,
      expectedSha256: null,
      platform: process.platform,
      architecture: process.arch,
    },
    storage: {
      directoryName: basename(configDirectory),
      tokensPresent: auth.isAuthenticated,
      permissions: "platform-default",
    },
    policy: {
      allowedCommands: [],
      environment: "minimal",
      passwordTransport: "in-memory-call",
      smsCodeTransport: "in-memory-call",
      vehicleControlsExposed: false,
      sessionCache: {
        storage: "memory-only",
        rawResponsesStored: false,
        persistsAcrossRestarts: false,
        manualRefreshBypasses: true,
      },
    },
  });
