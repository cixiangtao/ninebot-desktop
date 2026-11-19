export { ninebotCandidateRsaPublicKeyPem } from "./protocol-public-key.ts";
import { createPublicKey } from "node:crypto";

/** Validates the RSA shape observed in ninecli's 128-byte `k`/`s` fields. */
export const assertNinebotCandidateRsaPublicKey = (publicKey: Uint8Array | string) => {
  let details: ReturnType<typeof createPublicKey>["asymmetricKeyDetails"];
  try {
    details = createPublicKey(publicKey).asymmetricKeyDetails;
  } catch {
    throw new Error("Ninebot candidate RSA public key is invalid");
  }
  if (details?.modulusLength !== 1024 || details.publicExponent !== 65_537n) {
    throw new Error("Ninebot candidate RSA public key must be 1024-bit with exponent 65537");
  }
};
