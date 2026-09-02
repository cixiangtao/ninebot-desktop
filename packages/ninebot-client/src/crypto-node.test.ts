import { createCipheriv, generateKeyPairSync, privateDecrypt, constants } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeNinebotBase64, decryptAesCbcPkcs7, encryptRsaPkcs1v15 } from "./crypto-node.ts";

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
