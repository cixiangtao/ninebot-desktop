import {
  computeNinebotCheckcode,
  decodeNinebotBase64,
  decryptAesCbcPkcs7,
  deriveNinebotKeyCandidate,
  encodeNinebotBase64,
  encryptAesCbcPkcs7,
  encryptRsaPkcs1v15,
} from "./crypto-node.ts";
import type {
  NinebotEncryptedRequestEnvelope,
  NinebotEncryptedResponseEnvelope,
} from "./crypto-envelope.ts";

const textEncoder = new TextEncoder();

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
  timeStamp: number;
  p: string;
  t: string;
}

export interface BuildNinebotEncryptedRequestCandidateOptions {
  plaintextBody: Uint8Array;
  material: NinebotCandidateRequestMaterial;
  rsaPublicKey: Uint8Array | string;
}

const assertSafeInteger = (value: number, name: string) => {
  if (!Number.isSafeInteger(value)) throw new Error(`Ninebot ${name} must be a safe integer`);
};

const encodeWrapper = (plaintextBody: Uint8Array, material: NinebotCandidateRequestMaterial) => {
  assertSafeInteger(material.platform, "platform");
  assertSafeInteger(material.timeStamp, "timeStamp");
  return textEncoder.encode(
    `{\n\t"data" : "${encodeNinebotBase64(plaintextBody)}",\n\t"keyDataFour" : "${material.keyData.keyDataFour}",\n\t"keyDataOne" : "${material.keyData.keyDataOne}",\n\t"keyDataTwo" : "${material.keyData.keyDataTwo}",\n\t"keyDataThree" : "${material.keyData.keyDataThree}",\n\t"platform" : ${material.platform},\n\t"timeStamp" : ${material.timeStamp}\n}\n`,
  );
};

const deriveCandidateKey = (keyData: NinebotCandidateKeyData) =>
  deriveNinebotKeyCandidate([
    textEncoder.encode(keyData.keyDataOne),
    textEncoder.encode(keyData.keyDataTwo),
    textEncoder.encode(keyData.keyDataThree),
    textEncoder.encode(keyData.keyDataFour),
  ]);

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
  const key = deriveCandidateKey(material.keyData);
  const encryptedBody = encryptAesCbcPkcs7({ plaintext: wrapper, key });
  const encryptedKReq = encryptRsaPkcs1v15(material.kReq, rsaPublicKey);
  return {
    d: encodeNinebotBase64(encryptedBody),
    h: computeNinebotCheckcode(wrapper),
    k: encodeNinebotBase64(encryptedKReq),
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
