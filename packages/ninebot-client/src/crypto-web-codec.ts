import {
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
} from "./crypto-web.ts";
import type {
  NinebotEncryptedRequestEnvelope,
  NinebotEncryptedResponseEnvelope,
} from "./crypto-envelope.ts";

const textEncoder = new TextEncoder();
const KEY_DATA_ONE_PATTERN = /^[0-9a-f]{11}$/;
const KEY_DATA_TWO_PATTERN = /^[0-9a-f]{11}$/;
const KEY_DATA_THREE_PATTERN = /^[0-9a-f]{10}$/;
const KEY_DATA_FOUR_PATTERN = /^[/a-zA-Z0-9;_.,+\\-]{8}$/;

/** Four random key-data values required to decrypt one response. */
export interface NinebotWebCandidateKeyData {
  keyDataOne: string;
  keyDataTwo: string;
  keyDataThree: string;
  keyDataFour: string;
}

/** Request material that must stay bound to one encrypted request/response pair. */
export interface NinebotWebCandidateRequestMaterial {
  keyData: NinebotWebCandidateKeyData;
  kReq: Uint8Array;
  platform: number;
  /** Unix epoch timestamp in seconds, as passed to the wrapper builder. */
  timeStamp: number;
  p: string;
  t: string;
}

export interface GenerateNinebotWebCandidateRequestMaterialOptions {
  platform: number;
  p: string;
  t: string;
  timeStamp?: number;
}

/** Generates browser-compatible request material using Web Crypto randomness. */
export const generateNinebotWebCandidateRequestMaterial = ({
  platform,
  p,
  t,
  timeStamp = Math.floor(Date.now() / 1000),
}: GenerateNinebotWebCandidateRequestMaterialOptions): NinebotWebCandidateRequestMaterial => ({
  keyData: generateNinebotKeyDataWeb(),
  kReq: textEncoder.encode(generateNinebotKReqWeb()),
  platform,
  timeStamp,
  p,
  t,
});

const assertSafeInteger = (value: number, name: string) => {
  if (!Number.isSafeInteger(value)) throw new Error(`Ninebot ${name} must be a safe integer`);
};

const assertKeyData = (keyData: NinebotWebCandidateKeyData) => {
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

const encodeWrapper = (plaintextBody: Uint8Array, material: NinebotWebCandidateRequestMaterial) => {
  assertSafeInteger(material.platform, "platform");
  assertSafeInteger(material.timeStamp, "timeStamp");
  assertKeyData(material.keyData);
  if (material.kReq.length !== 16) throw new Error("Ninebot candidate kReq must be 16 bytes");
  return textEncoder.encode(
    `{\n\t"data" : "${encodeNinebotAndroidBase64Web(plaintextBody).replaceAll("\n", "\\n")}",\n\t"keyDataFour" : "${material.keyData.keyDataFour}",\n\t"keyDataOne" : "${material.keyData.keyDataOne}",\n\t"keyDataTwo" : "${material.keyData.keyDataTwo}",\n\t"keyDataThree" : "${material.keyData.keyDataThree}",\n\t"platform" : ${material.platform},\n\t"timeStamp" : ${material.timeStamp}\n}\n`,
  );
};

export interface BuildNinebotWebEncryptedRequestCandidateOptions {
  plaintextBody: Uint8Array;
  material: NinebotWebCandidateRequestMaterial;
  rsaPublicKey: Uint8Array | string;
}

/** Builds the encrypted request envelope with browser-compatible primitives. */
export const buildNinebotEncryptedRequestCandidateWeb = async ({
  plaintextBody,
  material,
  rsaPublicKey,
}: BuildNinebotWebEncryptedRequestCandidateOptions): Promise<NinebotEncryptedRequestEnvelope> => {
  const wrapper = encodeWrapper(plaintextBody, material);
  const encryptedBody = await encryptAesCbcPkcs7Web({ plaintext: wrapper, key: material.kReq });
  const encryptedKReq = await encryptRsaPkcs1v15Web(material.kReq, rsaPublicKey);
  return {
    d: encodeNinebotBase64Web(encryptedBody),
    h: computeNinebotCheckcodeWeb(wrapper),
    k: encodeNinebotBase64Web(encryptedKReq),
    p: material.p,
    t: material.t,
  };
};

export interface DecryptNinebotWebResponseCandidateOptions {
  envelope: NinebotEncryptedResponseEnvelope;
  keyData: NinebotWebCandidateKeyData;
}

const deriveCandidateKey = (keyData: NinebotWebCandidateKeyData) => {
  assertKeyData(keyData);
  return deriveNinebotKeyCandidateWeb([
    textEncoder.encode(keyData.keyDataOne),
    textEncoder.encode(keyData.keyDataTwo),
    textEncoder.encode(keyData.keyDataThree),
    textEncoder.encode(keyData.keyDataFour),
  ]);
};

/** Decrypts the response `r` field with its request-bound key-data context. */
export const decryptNinebotResponseCandidateWeb = async ({
  envelope,
  keyData,
}: DecryptNinebotWebResponseCandidateOptions) =>
  decryptAesCbcPkcs7Web({
    ciphertext: decodeNinebotBase64Web(envelope.r, "response r"),
    key: deriveCandidateKey(keyData),
  });

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

/** Decodes the post-AES response object and its inner Base64 payload. */
export const decodeNinebotResponsePayloadCandidateWeb = (plaintext: Uint8Array) => {
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
  return decodeNinebotBase64Web(encodedPayload, "response payload");
};

/** Decrypts `r` and applies the observed unescape-plus-Base64 response stage. */
export const decryptNinebotResponsePayloadCandidateWeb = async ({
  envelope,
  keyData,
}: DecryptNinebotWebResponseCandidateOptions) =>
  decodeNinebotResponsePayloadCandidateWeb(
    await decryptNinebotResponseCandidateWeb({ envelope, keyData }),
  );

/** Binds asynchronous response decoding to one request's key-data context. */
export const createNinebotResponseCandidateDecoderWeb = (keyData: NinebotWebCandidateKeyData) => ({
  decrypt: (envelope: NinebotEncryptedResponseEnvelope) =>
    decryptNinebotResponseCandidateWeb({ envelope, keyData }),
  decode: (envelope: NinebotEncryptedResponseEnvelope) =>
    decryptNinebotResponsePayloadCandidateWeb({ envelope, keyData }),
});
