import {
  createNinebotFetchCandidateSessionClient,
  type NinebotCandidateSessionClient,
  type NinebotCandidateSessionFields,
} from "@jiuhao/ninebot-client/candidate-session";

/** Candidate requests should not hold the Electron UI while VPN/upstream is unavailable. */
export const candidateRequestTimeoutMs = 15_000;

/** Creates the app-scoped candidate client with a bounded read-only network lifetime. */
export const createCandidateSessionClient = (
  session: NinebotCandidateSessionFields,
): NinebotCandidateSessionClient =>
  createNinebotFetchCandidateSessionClient({
    session,
    platform: 2,
    timeoutMs: candidateRequestTimeoutMs,
  });
