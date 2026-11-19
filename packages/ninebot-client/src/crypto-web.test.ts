import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  computeNinebotBodyCheckcodeWeb,
  computeNinebotCheckcodeWeb,
  decodeNinebotBase64Web,
  decryptAesCbcPkcs7Web,
  deriveNinebotKeyCandidateWeb,
  encodeNinebotAndroidBase64Web,
  encodeNinebotBase64Web,
  encryptAesCbcPkcs7Web,
  encryptRsaPkcs1v15Web,
  generateNinebotKReqWeb,
  generateNinebotKeyDataWeb,
  generateNinebotNonceWeb,
} from "./crypto-web.ts";
import {
  decryptAesCbcPkcs7,
  deriveNinebotKeyCandidate,
  encryptAesCbcPkcs7,
} from "./crypto-node.ts";

const textEncoder = new TextEncoder();

describe("Web Crypto candidate primitives", () => {
  it("computes the same MD5 and canonical Base64 values as Node", () => {
    expect(computeNinebotCheckcodeWeb("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(computeNinebotCheckcodeWeb("fixture payload")).toBe("0b672a81b2a6b29c522404de433c0d68");
    expect(computeNinebotBodyCheckcodeWeb("fixture payload")).toBe(
      "0B672A81B2A6B29C522404DE433C0D68",
    );
    const encoded = encodeNinebotBase64Web(new Uint8Array([1, 2, 3, 4]));
    expect(encoded).toBe("AQIDBA==");
    expect(decodeNinebotBase64Web(encoded, "fixture")).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(() => decodeNinebotBase64Web("AQI", "fixture")).toThrow("canonical Base64");
  });

  it("matches Node AES-CBC encryption and decryption", async () => {
    const key = new Uint8Array(16).fill(3);
    const plaintext = textEncoder.encode("fixture payload");
    const nodeCiphertext = encryptAesCbcPkcs7({ plaintext, key });
    const webCiphertext = await encryptAesCbcPkcs7Web({ plaintext, key });
    expect(webCiphertext).toEqual(nodeCiphertext);
    expect(await decryptAesCbcPkcs7Web({ ciphertext: nodeCiphertext, key })).toEqual(plaintext);
    expect(await decryptAesCbcPkcs7({ ciphertext: webCiphertext, key })).toEqual(plaintext);
  });

  it("matches Node's four-input response key mixer", () => {
    const inputs = [
      textEncoder.encode("a"),
      textEncoder.encode("bc"),
      textEncoder.encode("def"),
      textEncoder.encode("ghij"),
    ] as const;
    expect(deriveNinebotKeyCandidateWeb(inputs)).toEqual(deriveNinebotKeyCandidate(inputs));
  });

  it("encrypts a short payload with Web Crypto RSA PKCS#1 v1.5", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const payload = textEncoder.encode("fixture");
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
    const ciphertext = await encryptRsaPkcs1v15Web(payload, publicKeyPem);
    expect(ciphertext).toHaveLength(128);
    expect(
      privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_PADDING }, ciphertext),
    ).toEqual(Buffer.from(payload));
  });

  it("generates the observed random material shapes", () => {
    expect(generateNinebotNonceWeb()).toMatch(/^[0-9a-f]{32}$/);
    expect(generateNinebotKReqWeb()).toMatch(/^[\x21-\x7e]{16}$/);
    expect(generateNinebotKeyDataWeb()).toMatchObject({
      keyDataOne: expect.stringMatching(/^[0-9a-f]{11}$/),
      keyDataTwo: expect.stringMatching(/^[0-9a-f]{11}$/),
      keyDataThree: expect.stringMatching(/^[0-9a-f]{10}$/),
      keyDataFour: expect.stringMatching(/^[a-zA-Z0-9;\-_.,+/]{8}$/),
    });
    const lines = encodeNinebotAndroidBase64Web(new Uint8Array(1_034)).split("\n");
    expect(lines.at(-1)).toBe("");
    expect(lines.slice(0, -1).every((line) => line.length <= 76)).toBe(true);
  });
});
