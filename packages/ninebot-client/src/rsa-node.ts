import { createPublicKey } from "node:crypto";

/**
 * RSA public key embedded in the bundled ninecli 0.1.7 binary.
 *
 * This is a public, 1024-bit PKCS#1 key recovered from the binary's static
 * data. It is exposed only for the Node candidate codec; callers may override
 * it explicitly, but must validate the complete request against the ninecli
 * oracle before using it for a service request.
 */
export const ninebotCandidateRsaPublicKeyPem = `-----BEGIN RSA PUBLIC KEY-----
MIGJAoGBANPebRz/zL1zXc/NoVsBMSD5nB2Sk9wLLRXbVUoEFLHXpyRW0sREBDsQ
fx3oOqARvLNrIDCVB3WAOFSbHbuENZp9ev3969RmSQF6Byw2cqsiWH3eU8pxyOT4
sNdLVOcMggWJOVJs2dpjB6Ej/2lRsoIjeHvITSm6bqEmH/1C0Y+XAgMBAAE=
-----END RSA PUBLIC KEY-----`;

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
