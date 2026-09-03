const AES_BLOCK_BYTES = 16;
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PRINTABLE_ASCII =
  "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
const KEY_DATA_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789;-_.,+/";
const KEY_DATA_HEX_ALPHABET = "0123456789abcdef";
const textEncoder = new TextEncoder();

const webCrypto = () => {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues || !crypto.subtle) {
    throw new Error("Ninebot Web Crypto API is unavailable");
  }
  return crypto;
};

const asBytes = (value: Uint8Array | string) =>
  typeof value === "string" ? textEncoder.encode(value) : value;

const copyBuffer = (value: Uint8Array) => {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
};

/** Encodes bytes with the canonical Base64 alphabet used by ninecli. */
export const encodeNinebotBase64Web = (value: Uint8Array) => {
  let output = "";
  for (let offset = 0; offset < value.length; offset += 3) {
    const first = value[offset] ?? 0;
    const second = value[offset + 1];
    const third = value[offset + 2];
    output += BASE64_ALPHABET[first >> 2];
    output += BASE64_ALPHABET[((first & 3) << 4) | ((second ?? 0) >> 4)];
    output +=
      second === undefined ? "=" : BASE64_ALPHABET[((second & 15) << 2) | ((third ?? 0) >> 6)];
    output += third === undefined ? "=" : BASE64_ALPHABET[third & 63];
  }
  return output;
};

/** Decodes and validates a canonical Base64 field. */
export const decodeNinebotBase64Web = (value: string, fieldName: string) => {
  if (!BASE64_PATTERN.test(value)) throw new Error(`Ninebot ${fieldName} is not canonical Base64`);
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const output = new Uint8Array((value.length / 4) * 3 - padding);
  let writeOffset = 0;
  for (let offset = 0; offset < value.length; offset += 4) {
    const first = BASE64_ALPHABET.indexOf(value[offset] ?? "");
    const second = BASE64_ALPHABET.indexOf(value[offset + 1] ?? "");
    const third = value[offset + 2] === "=" ? 0 : BASE64_ALPHABET.indexOf(value[offset + 2] ?? "");
    const fourth = value[offset + 3] === "=" ? 0 : BASE64_ALPHABET.indexOf(value[offset + 3] ?? "");
    output[writeOffset++] = (first << 2) | (second >> 4);
    if (writeOffset < output.length) output[writeOffset++] = ((second & 15) << 4) | (third >> 2);
    if (writeOffset < output.length) output[writeOffset++] = ((third & 3) << 6) | fourth;
  }
  if (encodeNinebotBase64Web(output) !== value) {
    throw new Error(`Ninebot ${fieldName} is not canonical Base64`);
  }
  return output;
};

/** Encodes request-body data with ninecli's 76-character Android Base64 lines. */
export const encodeNinebotAndroidBase64Web = (value: Uint8Array) => {
  const encoded = encodeNinebotBase64Web(value);
  const lines: string[] = [];
  for (let offset = 0; offset < encoded.length; offset += 76) {
    lines.push(encoded.slice(offset, offset + 76));
  }
  return `${lines.join("\n")}\n`;
};

const leftRotate = (value: number, amount: number) => (value << amount) | (value >>> (32 - amount));
const MD5_SHIFT = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
] as const;
const MD5_CONSTANTS = Array.from(
  { length: 64 },
  (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x1_0000_0000) >>> 0,
);

const md5Digest = (input: Uint8Array) => {
  const bitLength = input.length * 8;
  const paddedLength = ((input.length + 8) & ~63) + 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const lengthView = new DataView(padded.buffer);
  lengthView.setUint32(paddedLength - 8, bitLength >>> 0, true);
  lengthView.setUint32(paddedLength - 4, Math.floor(bitLength / 0x1_0000_0000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const view = new DataView(padded.buffer);
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = Array.from({ length: 16 }, (_, index) =>
      view.getUint32(offset + index * 4, true),
    );
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let index = 0; index < 64; index += 1) {
      let functionValue: number;
      let wordIndex: number;
      if (index < 16) {
        functionValue = (b & c) | (~b & d);
        wordIndex = index;
      } else if (index < 32) {
        functionValue = (d & b) | (~d & c);
        wordIndex = (5 * index + 1) % 16;
      } else if (index < 48) {
        functionValue = b ^ c ^ d;
        wordIndex = (3 * index + 5) % 16;
      } else {
        functionValue = c ^ (b | ~d);
        wordIndex = (7 * index) % 16;
      }
      const next =
        (a + functionValue + (MD5_CONSTANTS[index] ?? 0) + (words[wordIndex] ?? 0)) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + leftRotate(next, MD5_SHIFT[index] ?? 0)) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const digest = new Uint8Array(16);
  const digestView = new DataView(digest.buffer);
  digestView.setUint32(0, a0, true);
  digestView.setUint32(4, b0, true);
  digestView.setUint32(8, c0, true);
  digestView.setUint32(12, d0, true);
  return digest;
};

/** Computes the lowercase MD5 checkcode used by the encrypted wrapper. */
export const computeNinebotCheckcodeWeb = (value: Uint8Array | string) =>
  Array.from(md5Digest(asBytes(value)), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Computes the uppercase MD5 checkcode used inside business request bodies. */
export const computeNinebotBodyCheckcodeWeb = (value: Uint8Array | string) =>
  computeNinebotCheckcodeWeb(value).toUpperCase();

const assertAesKey = (key: Uint8Array) => {
  if (![16, 24, 32].includes(key.length)) throw new Error("Ninebot AES key has an invalid length");
};

/** Encrypts with Web Crypto AES-CBC using the observed zero IV and PKCS7 behavior. */
export const encryptAesCbcPkcs7Web = async ({
  plaintext,
  key,
  iv = new Uint8Array(AES_BLOCK_BYTES),
}: {
  plaintext: Uint8Array;
  key: Uint8Array;
  iv?: Uint8Array;
}) => {
  if (iv.length !== AES_BLOCK_BYTES) throw new Error("Ninebot AES-CBC IV must be 16 bytes");
  assertAesKey(key);
  const crypto = webCrypto();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    copyBuffer(key),
    { name: "AES-CBC" },
    false,
    ["encrypt"],
  );
  return new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-CBC", iv: copyBuffer(iv) },
      cryptoKey,
      copyBuffer(plaintext),
    ),
  );
};

/** Decrypts with Web Crypto AES-CBC and returns strictly validated unpadded bytes. */
export const decryptAesCbcPkcs7Web = async ({
  ciphertext,
  key,
  iv = new Uint8Array(AES_BLOCK_BYTES),
}: {
  ciphertext: Uint8Array;
  key: Uint8Array;
  iv?: Uint8Array;
}) => {
  if (ciphertext.length === 0 || ciphertext.length % AES_BLOCK_BYTES !== 0) {
    throw new Error("Ninebot AES ciphertext has an invalid length");
  }
  if (iv.length !== AES_BLOCK_BYTES) throw new Error("Ninebot AES-CBC IV must be 16 bytes");
  assertAesKey(key);
  const crypto = webCrypto();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    copyBuffer(key),
    { name: "AES-CBC" },
    false,
    ["decrypt"],
  );
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: copyBuffer(iv) },
      cryptoKey,
      copyBuffer(ciphertext),
    ),
  );
};

const decodePem = (value: string) => {
  const body = value
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s/g, "");
  return decodeNinebotBase64Web(body, "RSA public key");
};

const readDerElement = (bytes: Uint8Array, offset: number) => {
  const tag = bytes[offset];
  const lengthByte = bytes[offset + 1];
  if (tag === undefined || lengthByte === undefined)
    throw new Error("Ninebot RSA key is truncated");
  let length = lengthByte;
  let cursor = offset + 2;
  if ((lengthByte & 0x80) !== 0) {
    const lengthBytes = lengthByte & 0x7f;
    if (lengthBytes === 0 || lengthBytes > 4) throw new Error("Ninebot RSA key length is invalid");
    length = 0;
    for (let index = 0; index < lengthBytes; index += 1) {
      const byte = bytes[cursor++];
      if (byte === undefined) throw new Error("Ninebot RSA key is truncated");
      length = length * 256 + byte;
    }
  }
  const end = cursor + length;
  if (end > bytes.length) throw new Error("Ninebot RSA key is truncated");
  return { tag, content: bytes.subarray(cursor, end), end };
};

const bytesToBigInt = (bytes: Uint8Array) => {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
};

const bigIntToBytes = (value: bigint, length: number) => {
  const output = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  if (remaining !== 0n) throw new Error("Ninebot RSA ciphertext does not fit the modulus");
  return output;
};

const modPow = (base: bigint, exponent: bigint, modulus: bigint) => {
  let result = 1n;
  let value = base % modulus;
  let power = exponent;
  while (power > 0n) {
    if ((power & 1n) === 1n) result = (result * value) % modulus;
    value = (value * value) % modulus;
    power >>= 1n;
  }
  return result;
};

const parseRsaPublicKey = (bytes: Uint8Array) => {
  const root = readDerElement(bytes, 0);
  if (root.tag !== 0x30) throw new Error("Ninebot RSA public key is not an SPKI sequence");
  const algorithm = readDerElement(root.content, 0);
  const bitString = readDerElement(root.content, algorithm.end);
  if (bitString.tag !== 0x03 || bitString.content[0] !== 0) {
    throw new Error("Ninebot RSA public key bit string is invalid");
  }
  const rsaSequence = readDerElement(bitString.content, 1);
  if (rsaSequence.tag !== 0x30) throw new Error("Ninebot RSA public key body is invalid");
  const modulus = readDerElement(rsaSequence.content, 0);
  const exponent = readDerElement(rsaSequence.content, modulus.end);
  if (modulus.tag !== 0x02 || exponent.tag !== 0x02) {
    throw new Error("Ninebot RSA public key integers are invalid");
  }
  const modulusBytes = modulus.content[0] === 0 ? modulus.content.subarray(1) : modulus.content;
  const modulusValue = bytesToBigInt(modulusBytes);
  const exponentValue = bytesToBigInt(exponent.content);
  if (modulusBytes.length !== 128 || exponentValue !== 65_537n) {
    throw new Error("Ninebot RSA public key must be 1024-bit with exponent 65537");
  }
  return { modulus: modulusValue, modulusLength: modulusBytes.length, exponent: exponentValue };
};

const randomNonZeroBytes = (length: number) => {
  const crypto = webCrypto();
  const output = new Uint8Array(length);
  let offset = 0;
  while (offset < length) {
    const random = crypto.getRandomValues(new Uint8Array(length - offset));
    for (const byte of random) {
      if (byte === 0) continue;
      output[offset++] = byte;
      if (offset === length) break;
    }
  }
  return output;
};

/** Encrypts a short payload with browser-compatible RSA PKCS#1 v1.5 padding. */
export const encryptRsaPkcs1v15Web = async (
  payload: Uint8Array,
  publicKey: Uint8Array | string,
) => {
  const key = parseRsaPublicKey(typeof publicKey === "string" ? decodePem(publicKey) : publicKey);
  if (payload.length > key.modulusLength - 11) {
    throw new Error("Ninebot RSA payload is too long");
  }
  const padding = randomNonZeroBytes(key.modulusLength - payload.length - 3);
  const encoded = new Uint8Array(key.modulusLength);
  encoded[0] = 0;
  encoded[1] = 2;
  encoded.set(padding, 2);
  encoded[padding.length + 2] = 0;
  encoded.set(payload, padding.length + 3);
  return bigIntToBytes(
    modPow(bytesToBigInt(encoded), key.exponent, key.modulus),
    key.modulusLength,
  );
};

const rotateRight = (value: number, amount: number) =>
  ((value >>> amount) | (value << (32 - amount))) >>> 0;
const rotateLeft8 = (value: number) => ((value << 8) | (value >>> 24)) >>> 0;
const rollingWord = (value: Uint8Array) => {
  let word = 0;
  for (const byte of value) word = (rotateLeft8(word) ^ byte) >>> 0;
  return word;
};

/** Reproduces the four-input response key mixer observed in ninecli. */
export const deriveNinebotKeyCandidateWeb = (
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
  const output = new Uint8Array(16);
  const view = new DataView(output.buffer);
  view.setUint32(0, word3, true);
  view.setUint32(4, word2, true);
  view.setUint32(8, word1, true);
  view.setUint32(12, word0, true);
  return output;
};

const randomFromAlphabet = (length: number, alphabet: string) => {
  if (!Number.isSafeInteger(length) || length < 0)
    throw new Error("Ninebot random length is invalid");
  if (alphabet.length === 0) throw new Error("Ninebot random alphabet is empty");
  const crypto = webCrypto();
  const output = new Uint8Array(length);
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  let offset = 0;
  while (offset < length) {
    const random = crypto.getRandomValues(new Uint8Array(Math.max(1, length - offset)));
    for (const byte of random) {
      if (byte >= limit) continue;
      output[offset] = alphabet.charCodeAt(byte % alphabet.length);
      offset += 1;
      if (offset === length) break;
    }
  }
  return new TextDecoder().decode(output);
};

/** Generates the 32-character hexadecimal nonce used by ninecli. */
export const generateNinebotNonceWeb = () => randomFromAlphabet(32, KEY_DATA_HEX_ALPHABET);

/** Generates the 16-character RSA input material used by ninecli's `GenKReq`. */
export const generateNinebotKReqWeb = () => randomFromAlphabet(16, PRINTABLE_ASCII);

/** Generates the four random key-data strings used by the encrypted wrapper. */
export const generateNinebotKeyDataWeb = () => ({
  keyDataOne: randomFromAlphabet(11, KEY_DATA_HEX_ALPHABET),
  keyDataTwo: randomFromAlphabet(11, KEY_DATA_HEX_ALPHABET),
  keyDataThree: randomFromAlphabet(10, KEY_DATA_HEX_ALPHABET),
  keyDataFour: randomFromAlphabet(8, KEY_DATA_ALPHABET),
});
