import {
  buildPassportCanonicalString,
  type PassportRefreshRequestSigner,
  type PassportRequestSigner,
  type PassportWhoamiRequestSigner,
  type PassportSmsRequestSigner,
} from "./passport-auth.ts";

const textEncoder = new TextEncoder();

const signCanonical = async (canonical: string) => {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto SHA-256 is unavailable in this runtime");
  }
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", textEncoder.encode(canonical)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** Creates a browser-compatible Passport signer using Web Crypto SHA-256. */
export const createNinebotPassportWebSigner = (): {
  login: PassportRequestSigner;
  refresh: PassportRefreshRequestSigner;
  whoami: PassportWhoamiRequestSigner;
  sms: PassportSmsRequestSigner;
} => ({
  login: async (input) => signCanonical(buildPassportCanonicalString(input)),
  refresh: async (input) => signCanonical(buildPassportCanonicalString(input)),
  whoami: async (input) => signCanonical(buildPassportCanonicalString(input)),
  sms: async (input) => signCanonical(buildPassportCanonicalString(input)),
});
