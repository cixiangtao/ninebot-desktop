import type {
  NinebotAuthProvider,
  NinebotAuthSession,
  NinebotPasswordCredentials,
  NinebotSmsCodeRequest,
  NinebotSmsLoginInput,
} from "./auth.ts";

/** The Passport operations required by the shared authentication lifecycle. */
export interface NinebotPassportAuthClient {
  loginWithPassword(input: NinebotPasswordCredentials): Promise<NinebotAuthSession>;
  refresh(session: NinebotAuthSession): Promise<NinebotAuthSession>;
  whoami<T = unknown>(session: NinebotAuthSession): Promise<T>;
}

/** Stable error exposed when the upstream requires an interactive human check. */
export class NinebotHumanVerificationRequiredError extends Error {
  readonly code = "HUMAN_VERIFICATION_REQUIRED" as const;

  constructor(message = "Ninebot requires human verification before SMS login") {
    super(message);
    this.name = "NinebotHumanVerificationRequiredError";
  }
}

/**
 * Adapts the verified Passport client to the shared auth/session lifecycle.
 *
 * SMS endpoints deliberately fail closed: the upstream currently requires a human
 * verification challenge, so this adapter never pretends that a code was sent or
 * accepts an unverified code. Local session persistence and token refresh remain
 * available through `NinebotAuthSessionManager`.
 */
export const createNinebotPassportAuthProvider = (
  client: NinebotPassportAuthClient,
): NinebotAuthProvider => ({
  loginWithPassword: (credentials) => client.loginWithPassword(credentials),
  requestSmsCode: async (_input: NinebotSmsCodeRequest) => {
    throw new NinebotHumanVerificationRequiredError();
  },
  loginWithSmsCode: async (_input: NinebotSmsLoginInput) => {
    throw new NinebotHumanVerificationRequiredError();
  },
  whoami: <T = unknown>(session: NinebotAuthSession) => client.whoami<T>(session),
  refresh: (session) => client.refresh(session),
});
