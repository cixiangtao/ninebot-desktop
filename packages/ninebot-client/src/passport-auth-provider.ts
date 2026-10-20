import type {
  NinebotAuthProvider,
  NinebotAuthSession,
  NinebotPassportSession,
  NinebotSmsCodeRequest,
  NinebotSmsLoginInput,
} from "./auth.ts";
import type { BuildPasswordLoginRequestOptions } from "./passport-auth.ts";

/** The Passport operations required by the shared authentication lifecycle. */
export interface NinebotPassportAuthClient {
  loginWithPassword(
    input: Omit<BuildPasswordLoginRequestOptions, "signer">,
  ): Promise<NinebotPassportSession>;
  requestSmsCode?(input: NinebotSmsCodeRequest): Promise<void>;
  loginWithSmsCode?(input: NinebotSmsLoginInput): Promise<NinebotPassportSession>;
  refresh(session: NinebotPassportSession): Promise<NinebotPassportSession>;
  whoami<T = unknown>(session: NinebotPassportSession): Promise<T>;
}

/** Completes the encrypted business login and returns its independently validated UID. */
export interface NinebotPassportAuthProviderOptions {
  initializeBusinessSession: (session: NinebotPassportSession) => Promise<string>;
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
 * Combines Passport account authentication with the required business login stage.
 * Only a completed business bootstrap produces a persistable session.
 *
 * SMS uses the injected client and shares the same Business bootstrap. A client
 * without SMS capability fails as unsupported; server challenges stay errors. Local session persistence and token refresh remain
 * available through `NinebotAuthSessionManager`.
 */
export const createNinebotPassportAuthProvider = (
  client: NinebotPassportAuthClient,
  { initializeBusinessSession }: NinebotPassportAuthProviderOptions,
): NinebotAuthProvider => ({
  async loginWithPassword(credentials) {
    const passport = await client.loginWithPassword({
      areaCode: credentials.areaCode,
      username: credentials.user,
      password: credentials.password,
    });
    const businessUid = await initializeBusinessSession(passport);
    if (typeof businessUid !== "string" || !businessUid.trim()) {
      throw new Error("Ninebot business login returned an invalid uid");
    }
    return { ...passport, businessUid };
  },
  requestSmsCode: async (input: NinebotSmsCodeRequest) => {
    if (!client.requestSmsCode) throw new Error("Passport SMS capability is unavailable");
    await client.requestSmsCode(input);
  },
  loginWithSmsCode: async (input: NinebotSmsLoginInput) => {
    if (!client.loginWithSmsCode) throw new Error("Passport SMS capability is unavailable");
    const passport = await client.loginWithSmsCode(input);
    const businessUid = await initializeBusinessSession(passport);
    if (typeof businessUid !== "string" || !businessUid.trim())
      throw new Error("Ninebot business login returned an invalid uid");
    return { ...passport, businessUid };
  },
  whoami: <T = unknown>(session: NinebotAuthSession) => client.whoami<T>(session),
  async refresh(session: NinebotAuthSession) {
    const passport = await client.refresh(session);
    return { ...passport, businessUid: session.businessUid };
  },
});
