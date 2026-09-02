import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  publicEncrypt,
  randomBytes,
} from "node:crypto";

const AES_BLOCK_BYTES = 16;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Decodes a canonical Base64 field from a Ninebot encrypted envelope. */
export const decodeNinebotBase64 = (value: string, fieldName: string) => {
  if (!BASE64_PATTERN.test(value)) throw new Error(`Ninebot ${fieldName} is not canonical Base64`);
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new Error(`Ninebot ${fieldName} is not canonical Base64`);
  }
  return new Uint8Array(decoded);
};

const removePkcs7 = (plaintext: Uint8Array) => {
  if (plaintext.length === 0 || plaintext.length % AES_BLOCK_BYTES !== 0) {
    throw new Error("Ninebot PKCS7 plaintext has an invalid length");
  }
  const padding = plaintext.at(-1) ?? 0;
  if (padding < 1 || padding > AES_BLOCK_BYTES || padding > plaintext.length) {
    throw new Error("Ninebot PKCS7 plaintext has an invalid pad byte");
  }
  for (const byte of plaintext.slice(-padding)) {
    if (byte !== padding) throw new Error("Ninebot PKCS7 plaintext has an invalid pad byte");
  }
  return plaintext.slice(0, -padding);
};

/** Decrypts an AES-CBC ciphertext with strict PKCS7 validation. */
export const decryptAesCbcPkcs7 = ({
  ciphertext,
  key,
  iv,
}: {
  ciphertext: Uint8Array;
  key: Uint8Array;
  iv: Uint8Array;
}) => {
  if (ciphertext.length === 0 || ciphertext.length % AES_BLOCK_BYTES !== 0) {
    throw new Error("Ninebot AES ciphertext has an invalid length");
  }
  if (iv.length !== AES_BLOCK_BYTES) throw new Error("Ninebot AES-CBC IV must be 16 bytes");
  if (![16, 24, 32].includes(key.length)) throw new Error("Ninebot AES key has an invalid length");
  const decipher = createDecipheriv(`aes-${key.length * 8}-cbc`, key, iv);
  decipher.setAutoPadding(false);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return removePkcs7(new Uint8Array(plaintext));
};

/** Encrypts a payload with AES-CBC and the same strict PKCS7 block policy. */
export const encryptAesCbcPkcs7 = ({
  plaintext,
  key,
  iv = new Uint8Array(AES_BLOCK_BYTES),
}: {
  plaintext: Uint8Array;
  key: Uint8Array;
  iv?: Uint8Array;
}) => {
  if (iv.length !== AES_BLOCK_BYTES) throw new Error("Ninebot AES-CBC IV must be 16 bytes");
  if (![16, 24, 32].includes(key.length)) throw new Error("Ninebot AES key has an invalid length");
  const cipher = createCipheriv(`aes-${key.length * 8}-cbc`, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return new Uint8Array(ciphertext);
};

/** Encodes bytes with the canonical standard Base64 alphabet used by ninecli. */
export const encodeNinebotBase64 = (value: Uint8Array) => Buffer.from(value).toString("base64");

/** Computes the 32-character lowercase MD5 checkcode used by the business wrapper. */
export const computeNinebotCheckcode = (value: Uint8Array | string) =>
  createHash("md5")
    .update(typeof value === "string" ? Buffer.from(value) : value)
    .digest("hex");

const rotateLeft8 = (value: number) => ((value << 8) | (value >>> 24)) >>> 0;

const rollingWord = (value: Uint8Array) => {
  let word = 0;
  for (const byte of value) word = (rotateLeft8(word) ^ byte) >>> 0;
  return word;
};

const rotateRight = (value: number, amount: number) =>
  ((value >>> amount) | (value << (32 - amount))) >>> 0;

const writeLittleEndianWords = (words: number[]) => {
  const output = new Uint8Array(words.length * 4);
  const view = new DataView(output.buffer);
  words.forEach((word, index) => view.setUint32(index * 4, word >>> 0, true));
  return output;
};

/**
 * Reproduces the custom four-input key mixer found in ninecli's crypto package.
 *
 * This is intentionally exposed as a candidate primitive: the binary reveals the
 * mixer, but the endpoint-specific input ordering still needs oracle validation.
 */
export const deriveNinebotKeyCandidate = (
  inputs: readonly [Uint8Array, Uint8Array, Uint8Array, Uint8Array],
) => {
  const first = rollingWord(inputs[0]);
  const second = rollingWord(inputs[1]);
  const third = rollingWord(inputs[2]);
  const fourth = rollingWord(inputs[3]);
  const xorFirstThird = second ^ fourth;
  const xorFirstSecond = first ^ third;
  const mixedSecond = xorFirstSecond ^ rotateRight(xorFirstSecond, 24);
  const mixedSecondRotated = mixedSecond ^ rotateRight(xorFirstSecond, 8);
  const left = second ^ mixedSecondRotated;
  const right = fourth ^ mixedSecondRotated;
  const mixedFirst = xorFirstThird ^ rotateRight(xorFirstThird, 24);
  const mixedFirstRotated = mixedFirst ^ rotateRight(xorFirstThird, 8);
  const leftMix = third ^ mixedFirstRotated;
  const rightMix = first ^ mixedFirstRotated;
  const word0 = (rightMix ^ (leftMix & left)) >>> 0;
  const orMix = (leftMix | right) >>> 0;
  const notMix = (~(orMix ^ left) ^ (right ^ leftMix)) >>> 0;
  const word1 = (word0 ^ notMix) >>> 0;
  const word2 = ((word0 | notMix) ^ (orMix ^ left)) >>> 0;
  const word3 = (word1 & ((~orMix ^ left) >>> 0)) ^ right;
  return writeLittleEndianWords([word3, word2, word1, word0]);
};

/** Generates the 32-character lowercase hexadecimal nonce emitted by ninecli. */
export const generateNinebotNonce = () => randomBytes(16).toString("hex");

/** Encrypts a short payload with an RSA public key using PKCS#1 v1.5 padding. */
export const encryptRsaPkcs1v15 = (payload: Uint8Array, publicKey: Uint8Array | string) =>
  new Uint8Array(
    publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(payload)),
  );
