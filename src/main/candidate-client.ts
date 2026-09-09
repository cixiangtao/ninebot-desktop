import {
  createNinebotFetchCandidateSessionClient,
  type NinebotCandidateSessionClient,
  type NinebotCandidateSessionFields,
} from "@jiuhao/ninebot-client/candidate-session";

/** Default upper bound for a candidate request when the upstream is unavailable. */
// Monthly pagination can involve several sequential encrypted requests; keep
// parity with the ninecli command timeout so a slow page is not cut off early.
export const defaultCandidateRequestTimeoutMs = 45_000;

/** Keep an environment override bounded so a stalled candidate cannot hold the UI indefinitely. */
export const maxCandidateRequestTimeoutMs = 120_000;

/**
 * Resolves the candidate request timeout from environment configuration.
 *
 * Invalid, empty, fractional, and non-positive values fall back to the default;
 * valid values above the safety cap are clamped to the cap.
 */
export const resolveCandidateRequestTimeoutMs = (
  environment: Record<string, string | undefined>,
) => {
  const rawValue = environment.NINEBOT_CANDIDATE_TIMEOUT_MS?.trim();
  if (!rawValue || !/^\d+$/.test(rawValue)) return defaultCandidateRequestTimeoutMs;

  const timeoutMs = Number(rawValue);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    return defaultCandidateRequestTimeoutMs;
  }

  return Math.min(timeoutMs, maxCandidateRequestTimeoutMs);
};

/** Candidate requests should not hold the Electron UI while VPN/upstream is unavailable. */
export const candidateRequestTimeoutMs = resolveCandidateRequestTimeoutMs(process.env);

/** Creates the app-scoped candidate client with a bounded read-only network lifetime. */
export const createCandidateSessionClient = (
  session: NinebotCandidateSessionFields,
): NinebotCandidateSessionClient =>
  createNinebotFetchCandidateSessionClient({
    session,
    platform: 2,
    timeoutMs: candidateRequestTimeoutMs,
  });
