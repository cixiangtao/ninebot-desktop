import { createHash } from "node:crypto";
import {
  buildPassportCanonicalString,
  type PassportRefreshRequestSigner,
  type PassportRequestSigner,
  type PassportWhoamiRequestSigner,
} from "./passport-auth.ts";

const signCanonical = (canonical: string) => createHash("sha256").update(canonical).digest("hex");

/** Creates the verified SHA-256 Passport signer recovered from ninecli 0.1.7. */
export const createNinebotPassportSigner = (): {
  login: PassportRequestSigner;
  refresh: PassportRefreshRequestSigner;
  whoami: PassportWhoamiRequestSigner;
} => ({
  login: (input) => signCanonical(buildPassportCanonicalString(input)),
  refresh: (input) => signCanonical(buildPassportCanonicalString(input)),
  whoami: (input) => signCanonical(buildPassportCanonicalString(input)),
});

export const signNinebotPassportRequest = (input: Parameters<PassportRequestSigner>[0]) =>
  signCanonical(buildPassportCanonicalString(input));
