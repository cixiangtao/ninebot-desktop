import { createCipheriv, generateKeyPairSync, privateDecrypt, constants } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeNinebotCheckcode,
  decodeNinebotBase64,
  decryptAesCbcPkcs7,
  deriveNinebotKeyCandidate,
  encodeNinebotBase64,
  encryptAesCbcPkcs7,
  encryptRsaPkcs1v15,
  generateNinebotNonce,
} from "./crypto-node.ts";

describe("Node crypto candidates", () => {
  it("decodes only canonical Base64 fields", () => {
    expect(decodeNinebotBase64("AQIDBA==", "cipher")).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(() => decodeNinebotBase64("AQI", "cipher")).toThrow("canonical Base64");
  });

  it("decrypts AES-CBC with strict PKCS7 validation", () => {
    const key = Buffer.alloc(16, 7);
    const iv = Buffer.alloc(16, 9);
    const cipher = createCipheriv("aes-128-cbc", key, iv);
    const ciphertext = Buffer.concat([cipher.update("fixture payload"), cipher.final()]);
    expect(decryptAesCbcPkcs7({ ciphertext, key, iv })).toEqual(
      new TextEncoder().encode("fixture payload"),
    );
    expect(() => decryptAesCbcPkcs7({ ciphertext: ciphertext.subarray(1), key, iv })).toThrow(
      "invalid length",
    );
  });

  it("round-trips the zero-IV AES-CBC candidate", () => {
    const key = Buffer.alloc(16, 3);
    const plaintext = new TextEncoder().encode("fixture payload");
    const ciphertext = encryptAesCbcPkcs7({ plaintext, key });
    expect(decryptAesCbcPkcs7({ ciphertext, key, iv: new Uint8Array(16) })).toEqual(plaintext);
  });

  it("computes the lowercase MD5 checkcode and canonical Base64", () => {
    expect(computeNinebotCheckcode("fixture payload")).toBe("0b672a81b2a6b29c522404de433c0d68");
    const encoded = encodeNinebotBase64(new Uint8Array([1, 2, 3, 4]));
    expect(encoded).toBe("AQIDBA==");
    expect(decodeNinebotBase64(encoded, "cipher")).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("reproduces the binary's four-input key mixer candidate", () => {
    expect(
      Buffer.from(
        deriveNinebotKeyCandidate([
          new TextEncoder().encode("a"),
          new TextEncoder().encode("bc"),
          new TextEncoder().encode("def"),
          new TextEncoder().encode("ghij"),
        ]),
      ).toString("hex"),
    ).toBe("f99ffb9cf5f5f6f9fbfa9a9c056e0404");
  });

  it("generates a 16-byte nonce rendered as lowercase hexadecimal", () => {
    expect(generateNinebotNonce()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("uses RSA PKCS#1 v1.5 public-key encryption", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const payload = new TextEncoder().encode("fixture");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
    const ciphertext = encryptRsaPkcs1v15(payload, publicKeyPem);
    expect(ciphertext).toHaveLength(128);
    expect(
      privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, ciphertext),
    ).toEqual(Buffer.from(payload));
  });
});
