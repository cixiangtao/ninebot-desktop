import { createPublicKey, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptRsaPkcs1v15 } from "./crypto-node.ts";
import { assertNinebotCandidateRsaPublicKey, ninebotCandidateRsaPublicKeyPem } from "./rsa-node.ts";

describe("ninecli RSA public-key candidate", () => {
  it("parses as the embedded 1024-bit PKCS#1 public key", () => {
    const key = createPublicKey(ninebotCandidateRsaPublicKeyPem).asymmetricKeyDetails;
    expect(key).toMatchObject({ modulusLength: 1024, publicExponent: 65_537n });
  });

  it("encrypts a short request key with the extracted public key", () => {
    expect(
      encryptRsaPkcs1v15(
        new TextEncoder().encode("0123456789abcdef"),
        ninebotCandidateRsaPublicKeyPem,
      ),
    ).toHaveLength(128);
  });

  it("rejects a key shape that cannot produce ninecli's 128-byte field", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() =>
      assertNinebotCandidateRsaPublicKey(publicKey.export({ type: "spki", format: "pem" })),
    ).toThrow("1024-bit with exponent 65537");
  });
});
