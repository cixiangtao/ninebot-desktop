import {
  computeNinebotCheckcode,
  decodeNinebotBase64,
  decryptAesCbcPkcs7,
  deriveNinebotKeyCandidate,
  encodeNinebotAndroidBase64,
  encodeNinebotBase64 as encodeNinebotCanonicalBase64,
  encryptAesCbcPkcs7,
  encryptRsaPkcs1v15,
  generateNinebotKReq,
  generateNinebotKeyData,
} from "./crypto-node.ts";
import type {
  NinebotEncryptedRequestEnvelope,
  NinebotEncryptedResponseEnvelope,
} from "./crypto-envelope.ts";

const textEncoder = new TextEncoder();
const encodeNinebotBase64 = (value: Uint8Array) =>
  encodeNinebotAndroidBase64(value).replaceAll("\n", "\\n");
const KEY_DATA_ONE_PATTERN = /^[0-9a-f]{11}$/;
const KEY_DATA_TWO_PATTERN = /^[0-9a-f]{11}$/;
const KEY_DATA_THREE_PATTERN = /^[0-9a-f]{10}$/;
const KEY_DATA_FOUR_PATTERN = /^[/a-zA-Z0-9;_.,+\\-]{8}$/;

export interface NinebotCandidateKeyData {
  keyDataOne: string;
  keyDataTwo: string;
  keyDataThree: string;
  keyDataFour: string;
}

export interface NinebotCandidateRequestMaterial {
  keyData: NinebotCandidateKeyData;
  kReq: Uint8Array;
  platform: number;
  /** Unix epoch timestamp in seconds, as passed to ninecli's wrapper builder. */
  timeStamp: number;
  p: string;
  t: string;
}

export interface GenerateNinebotCandidateRequestMaterialOptions {
  platform: number;
  p: string;
  t: string;
  timeStamp?: number;
}

/**
 * Generates fresh request material using the lengths and timestamp unit
 * observed in ninecli. The result is intentionally a candidate, not a proof
 * that any particular service accepts the generated values.
 */
export const generateNinebotCandidateRequestMaterial = ({
  platform,
  p,
  t,
  timeStamp = Math.floor(Date.now() / 1000),
}: GenerateNinebotCandidateRequestMaterialOptions): NinebotCandidateRequestMaterial => ({
  keyData: generateNinebotKeyData(),
  kReq: textEncoder.encode(generateNinebotKReq()),
  platform,
  timeStamp,
  p,
  t,
});

export interface BuildNinebotEncryptedRequestCandidateOptions {
  plaintextBody: Uint8Array;
  material: NinebotCandidateRequestMaterial;
  rsaPublicKey: Uint8Array | string;
}

const assertSafeInteger = (value: number, name: string) => {
  if (!Number.isSafeInteger(value)) throw new Error(`Ninebot ${name} must be a safe integer`);
};

const assertKeyData = (keyData: NinebotCandidateKeyData) => {
  if (!KEY_DATA_ONE_PATTERN.test(keyData.keyDataOne)) {
    throw new Error("Ninebot candidate keyDataOne must be 11 lowercase hexadecimal characters");
  }
  if (!KEY_DATA_TWO_PATTERN.test(keyData.keyDataTwo)) {
    throw new Error("Ninebot candidate keyDataTwo must be 11 lowercase hexadecimal characters");
  }
  if (!KEY_DATA_THREE_PATTERN.test(keyData.keyDataThree)) {
    throw new Error("Ninebot candidate keyDataThree must be 10 lowercase hexadecimal characters");
  }
  if (!KEY_DATA_FOUR_PATTERN.test(keyData.keyDataFour)) {
    throw new Error("Ninebot candidate keyDataFour must be 8 allowed characters");
  }
};

const encodeWrapper = (plaintextBody: Uint8Array, material: NinebotCandidateRequestMaterial) => {
  assertSafeInteger(material.platform, "platform");
  assertSafeInteger(material.timeStamp, "timeStamp");
  assertKeyData(material.keyData);
  if (material.kReq.length !== 16) throw new Error("Ninebot candidate kReq must be 16 bytes");
  return textEncoder.encode(
    `{\n\t"data" : "${encodeNinebotBase64(plaintextBody)}",\n\t"keyDataFour" : "${material.keyData.keyDataFour}",\n\t"keyDataOne" : "${material.keyData.keyDataOne}",\n\t"keyDataTwo" : "${material.keyData.keyDataTwo}",\n\t"keyDataThree" : "${material.keyData.keyDataThree}",\n\t"platform" : ${material.platform},\n\t"timeStamp" : ${material.timeStamp}\n}\n`,
  );
};

const deriveCandidateKey = (keyData: NinebotCandidateKeyData) => {
  assertKeyData(keyData);
  return deriveNinebotKeyCandidate([
    textEncoder.encode(keyData.keyDataOne),
    textEncoder.encode(keyData.keyDataTwo),
    textEncoder.encode(keyData.keyDataThree),
    textEncoder.encode(keyData.keyDataFour),
  ]);
};

/**
 * Builds the encrypted request shape reconstructed from ninecli's crypto package.
 *
 * The wrapper ordering and primitive operations are binary-backed candidates. The
 * endpoint-specific `p`/`t` values and key-data ordering still require oracle
 * validation before this helper is used as a default transport codec.
 */
export const buildNinebotEncryptedRequestCandidate = ({
  plaintextBody,
  material,
  rsaPublicKey,
}: BuildNinebotEncryptedRequestCandidateOptions): NinebotEncryptedRequestEnvelope => {
  const wrapper = encodeWrapper(plaintextBody, material);
  const encryptedBody = encryptAesCbcPkcs7({ plaintext: wrapper, key: material.kReq });
  const encryptedKReq = encryptRsaPkcs1v15(material.kReq, rsaPublicKey);
  return {
    d: encodeNinebotCanonicalBase64(encryptedBody),
    h: computeNinebotCheckcode(wrapper),
    k: encodeNinebotCanonicalBase64(encryptedKReq),
    p: material.p,
    t: material.t,
  };
};

export interface DecryptNinebotResponseCandidateOptions {
  envelope: NinebotEncryptedResponseEnvelope;
  keyData: NinebotCandidateKeyData;
}

/** Decrypts the response `r` field with the candidate four-input key derivation. */
export const decryptNinebotResponseCandidate = ({
  envelope,
  keyData,
}: DecryptNinebotResponseCandidateOptions) => {
  const ciphertext = decodeNinebotBase64(envelope.r, "response r");
  return decryptAesCbcPkcs7({ ciphertext, key: deriveCandidateKey(keyData) });
};

const unescapeJsonStringCandidate = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === "string") return parsed;
    } catch {
      // Fall through to the byte-wise candidate for partially escaped payloads.
    }
  }

  return trimmed
    .replace(/\\(["\\/bfnrt])/g, (_, escaped: string) => {
      const replacements: Record<string, string> = {
        '"': '"',
        "\\": "\\",
        "/": "/",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
      };
      return replacements[escaped] ?? escaped;
    })
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, codePoint: string) =>
      String.fromCharCode(Number.parseInt(codePoint, 16)),
    );
};

/**
 * Decodes the post-AES response payload observed in ninecli.
 *
 * The binary first AES-decrypts `r`, then unescapes the resulting JSON string
 * and Base64-decodes it again. This remains a candidate boundary until a
 * server-backed TypeScript request is validated against the ninecli oracle.
 */
export const decodeNinebotResponsePayloadCandidate = (plaintext: Uint8Array) => {
  const text = new TextDecoder().decode(plaintext);
  let encodedPayload = unescapeJsonStringCandidate(text);
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "data" in parsed &&
      typeof parsed.data === "string"
    ) {
      encodedPayload = unescapeJsonStringCandidate(parsed.data);
    }
  } catch {
    // The native response may already be a JSON-quoted string; keep the fallback above.
  }
  return decodeNinebotBase64(encodedPayload, "response payload");
};

/** Decrypts `r` and applies ninecli's observed unescape-plus-Base64 stage. */
export const decryptNinebotResponsePayloadCandidate = ({
  envelope,
  keyData,
}: DecryptNinebotResponseCandidateOptions) =>
  decodeNinebotResponsePayloadCandidate(decryptNinebotResponseCandidate({ envelope, keyData }));

export interface NinebotResponseCandidateDecoder {
  decrypt(envelope: NinebotEncryptedResponseEnvelope): Uint8Array;
  decode(envelope: NinebotEncryptedResponseEnvelope): Uint8Array;
}

/**
 * Binds response decoding to one request's keyData so concurrent requests do
 * not depend on shared mutable codec state.
 */
export const createNinebotResponseCandidateDecoder = (
  keyData: NinebotCandidateKeyData,
): NinebotResponseCandidateDecoder => ({
  decrypt: (envelope) => decryptNinebotResponseCandidate({ envelope, keyData }),
  decode: (envelope) => decryptNinebotResponsePayloadCandidate({ envelope, keyData }),
});
