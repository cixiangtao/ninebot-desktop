import { constants, createDecipheriv, publicEncrypt } from "node:crypto";

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

/** Encrypts a short payload with an RSA public key using PKCS#1 v1.5 padding. */
export const encryptRsaPkcs1v15 = (payload: Uint8Array, publicKey: Uint8Array | string) =>
  new Uint8Array(
    publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(payload)),
  );
