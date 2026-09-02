import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildNinebotEncryptedRequestCandidate,
  decryptNinebotResponseCandidate,
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
  keyDataOne: "0123456789abcdef0123456789",
  keyDataTwo: "fedcba9876543210fedcba987654",
  keyDataThree: "00112233445566778899",
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
      material: { keyData, kReq, platform: 2, timeStamp: 1_725_000_000_000, p: "100", t: "1" },
      rsaPublicKey: publicKey.export({ type: "spki", format: "pem" }),
    });

    const wrapper = decryptAesCbcPkcs7({
      ciphertext: decodeNinebotBase64(envelope.d, "request d"),
      key: kReq,
    });
    const wrapperText = new TextDecoder().decode(wrapper);
    expect(wrapperText).toBe(
      '{\n\t"data" : "eyJzZXJ2aWNlIjoidmVoaWNsZXMifQ==",\n\t"keyDataFour" : "Ab3;_+x/",\n\t"keyDataOne" : "0123456789abcdef0123456789",\n\t"keyDataTwo" : "fedcba9876543210fedcba987654",\n\t"keyDataThree" : "00112233445566778899",\n\t"platform" : 2,\n\t"timeStamp" : 1725000000000\n}\n',
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
});
