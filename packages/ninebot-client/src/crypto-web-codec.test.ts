import { constants, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildNinebotEncryptedRequestCandidateWeb,
  createNinebotResponseCandidateDecoderWeb,
  decryptNinebotResponseCandidateWeb,
  decryptNinebotResponsePayloadCandidateWeb,
  generateNinebotWebCandidateRequestMaterial,
  type NinebotWebCandidateKeyData,
} from "./crypto-web-codec.ts";
import {
  computeNinebotCheckcode,
  decodeNinebotBase64,
  decryptAesCbcPkcs7,
  deriveNinebotKeyCandidate,
  encodeNinebotBase64,
  encryptAesCbcPkcs7,
} from "./crypto-node.ts";

const textEncoder = new TextEncoder();
const keyData: NinebotWebCandidateKeyData = {
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

describe("Web candidate codec", () => {
  it("builds a request envelope compatible with the Node candidate codec", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const kReq = textEncoder.encode("0123456789abcdef");
    const material = {
      keyData,
      kReq,
      platform: 2,
      timeStamp: 1_725_000_000,
      p: "100",
      t: "1",
    };
    const envelope = await buildNinebotEncryptedRequestCandidateWeb({
      plaintextBody: textEncoder.encode('{"service":"vehicles"}'),
      material,
      rsaPublicKey: publicKey.export({ type: "spki", format: "pem" }),
    });
    const expectedWrapper =
      '{\n\t"data" : "eyJzZXJ2aWNlIjoidmVoaWNsZXMifQ==\\n",\n\t"keyDataFour" : "Ab3;_+x/",\n\t"keyDataOne" : "0123456789a",\n\t"keyDataTwo" : "fedcba98765",\n\t"keyDataThree" : "0011223344",\n\t"platform" : 2,\n\t"timeStamp" : 1725000000\n}\n';
    expect(
      new TextDecoder().decode(
        decryptAesCbcPkcs7({
          ciphertext: decodeNinebotBase64(envelope.d, "request d"),
          key: kReq,
        }),
      ),
    ).toBe(expectedWrapper);
    expect(envelope.h).toBe(computeNinebotCheckcode(new TextEncoder().encode(expectedWrapper)));
    expect(
      privateDecrypt(
        { key: privateKey, padding: constants.RSA_PKCS1_PADDING },
        decodeNinebotBase64(envelope.k, "request k"),
      ),
    ).toEqual(Buffer.from(kReq));
  });

  it("decrypts the response r field and inner Base64 payload", async () => {
    const payload = textEncoder.encode('{"vehicles":[{"id":"web"}]}');
    const responseJson = textEncoder.encode(
      JSON.stringify({ data: encodeNinebotBase64(payload), timeStamp: 1_725_000_000 }),
    );
    const ciphertext = encryptAesCbcPkcs7({ plaintext: responseJson, key: deriveKey() });
    const envelope = {
      v: 1,
      s: encodeNinebotBase64(new Uint8Array(128)),
      r: encodeNinebotBase64(ciphertext),
    };

    expect(await decryptNinebotResponseCandidateWeb({ envelope, keyData })).toEqual(responseJson);
    expect(await decryptNinebotResponsePayloadCandidateWeb({ envelope, keyData })).toEqual(payload);
    expect(await createNinebotResponseCandidateDecoderWeb(keyData).decode(envelope)).toEqual(
      payload,
    );
  });

  it("generates browser request material with the observed shapes", () => {
    const material = generateNinebotWebCandidateRequestMaterial({
      platform: 2,
      p: "101",
      t: "0",
      timeStamp: 1_725_000_000,
    });
    expect(material.kReq).toHaveLength(16);
    expect(material.keyData.keyDataOne).toMatch(/^[0-9a-f]{11}$/);
    expect(material.keyData.keyDataTwo).toMatch(/^[0-9a-f]{11}$/);
    expect(material.keyData.keyDataThree).toMatch(/^[0-9a-f]{10}$/);
    expect(material.keyData.keyDataFour).toMatch(/^[a-zA-Z0-9;\-_.,+/]{8}$/);
  });
});
