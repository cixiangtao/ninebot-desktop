import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildNinebotEncryptedRequestCandidate,
  createNinebotResponseCandidateDecoder,
  decryptNinebotResponsePayloadCandidate,
  decryptNinebotResponseCandidate,
  generateNinebotCandidateRequestMaterial,
  type NinebotCandidateKeyData,
} from "./crypto-codec.ts";
import {
  computeNinebotCheckcode,
  decodeNinebotBase64,
  decryptAesCbcPkcs7,
  deriveNinebotKeyCandidate,
  encodeNinebotBase64,
  encryptAesCbcPkcs7,
} from "./crypto-node.ts";

const textEncoder = new TextEncoder();
const keyData: NinebotCandidateKeyData = {
  keyDataOne: "0123456789a",
  keyDataTwo: "fedcba98765",
  keyDataThree: "0011223344",
  keyDataFour: "Ab3;_+x/",
};

const deriveKey = () =>
  deriveNinebotKeyCandidate([
    textEncoder.encode(keyData.keyDataOne),
    textEncoder.encode(keyData.keyDataTwo),
    textEncoder.encode(keyData.keyDataThree),
    textEncoder.encode(keyData.keyDataFour),
  ]);

describe("Ninebot crypto codec candidate", () => {
  it("builds the binary-backed wrapper, AES body, MD5 checkcode, and RSA k field", () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const kReq = textEncoder.encode("0123456789abcdef");
    const envelope = buildNinebotEncryptedRequestCandidate({
      plaintextBody: textEncoder.encode('{"service":"vehicles"}'),
      material: { keyData, kReq, platform: 2, timeStamp: 1_725_000_000, p: "100", t: "1" },
      rsaPublicKey: publicKey.export({ type: "spki", format: "pem" }),
    });

    const wrapper = decryptAesCbcPkcs7({
      ciphertext: decodeNinebotBase64(envelope.d, "request d"),
      key: kReq,
    });
    const wrapperText = new TextDecoder().decode(wrapper);
    expect(wrapperText).toBe(
      '{\n\t"data" : "eyJzZXJ2aWNlIjoidmVoaWNsZXMifQ==",\n\t"keyDataFour" : "Ab3;_+x/",\n\t"keyDataOne" : "0123456789a",\n\t"keyDataTwo" : "fedcba98765",\n\t"keyDataThree" : "0011223344",\n\t"platform" : 2,\n\t"timeStamp" : 1725000000\n}\n',
    );
    expect(envelope.h).toBe(computeNinebotCheckcode(wrapper));
    expect(
      privateDecrypt(
        { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
        decodeNinebotBase64(envelope.k, "request k"),
      ),
    ).toEqual(Buffer.from(kReq));
  });

  it("decrypts the response r field with the same candidate key material", () => {
    const plaintext = textEncoder.encode('{"vehicles":[]}');
    const ciphertext = encryptAesCbcPkcs7({ plaintext, key: deriveKey() });
    expect(
      decryptNinebotResponseCandidate({
        envelope: {
          v: 1,
          s: encodeNinebotBase64(new Uint8Array(128)),
          r: encodeNinebotBase64(ciphertext),
        },
        keyData,
      }),
    ).toEqual(plaintext);
  });

  it("decodes the escaped Base64 payload after response AES decryption", () => {
    const plaintext = textEncoder.encode('{"vehicles":[{"id":"demo"}]}');
    const encodedPayload = encodeNinebotBase64(plaintext);
    const escapedPayload = textEncoder.encode(JSON.stringify(encodedPayload));
    const ciphertext = encryptAesCbcPkcs7({ plaintext: escapedPayload, key: deriveKey() });

    expect(
      decryptNinebotResponsePayloadCandidate({
        envelope: {
          v: 1,
          s: encodeNinebotBase64(new Uint8Array(128)),
          r: encodeNinebotBase64(ciphertext),
        },
        keyData,
      }),
    ).toEqual(plaintext);
  });

  it("generates fresh request material with ninecli-compatible lengths", () => {
    const material = generateNinebotCandidateRequestMaterial({
      platform: 2,
      p: "100",
      t: "1",
      timeStamp: 1_725_000_000,
    });

    expect(material.kReq).toHaveLength(16);
    expect(material.keyData.keyDataOne).toHaveLength(11);
    expect(material.keyData.keyDataTwo).toHaveLength(11);
    expect(material.keyData.keyDataThree).toHaveLength(10);
    expect(material.keyData.keyDataFour).toHaveLength(8);
    expect(material.timeStamp).toBe(1_725_000_000);
  });

  it("binds response decoding to one request key-data set", () => {
    const plaintext = textEncoder.encode('{"vehicles":[]}');
    const ciphertext = encryptAesCbcPkcs7({ plaintext, key: deriveKey() });
    const decoder = createNinebotResponseCandidateDecoder(keyData);

    expect(
      decoder.decrypt({
        v: 1,
        s: encodeNinebotBase64(new Uint8Array(128)),
        r: encodeNinebotBase64(ciphertext),
      }),
    ).toEqual(plaintext);
  });
});
