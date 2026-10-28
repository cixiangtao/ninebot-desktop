import {
  buildNinebotEncryptedRequestCandidateWeb,
  decryptNinebotResponsePayloadCandidateWeb,
  generateNinebotWebCandidateRequestMaterial,
} from "./crypto-web-codec.ts";
import { generateNinebotNonceWeb } from "./crypto-web.ts";
import { createNinebotPassportWebSigner } from "./passport-signer.ts";
import { ninebotCandidateRsaPublicKeyPem } from "./protocol-public-key.ts";
import type { NinebotCryptoAdapter, NinebotCryptoAdapterOptions } from "./platform.ts";

/** Web Crypto adapter. Other hosts may implement the same contract with native crypto. */
export const createNinebotWebCryptoAdapter = ({
  platform = 2,
  p = "101",
  t = "0",
  timeStamp,
  rsaPublicKey = ninebotCandidateRsaPublicKeyPem,
}: NinebotCryptoAdapterOptions = {}): NinebotCryptoAdapter => {
  const signer = createNinebotPassportWebSigner();
  return {
    nonce: generateNinebotNonceWeb,
    passport: {
      signer: signer.login,
      smsSigner: signer.sms,
      refreshSigner: signer.refresh,
      whoamiSigner: signer.whoami,
    },
    async encode(plaintextBody) {
      const material = generateNinebotWebCandidateRequestMaterial({
        platform,
        p,
        t,
        ...(timeStamp === undefined ? {} : { timeStamp }),
      });
      return {
        envelope: await buildNinebotEncryptedRequestCandidateWeb({
          plaintextBody,
          material,
          rsaPublicKey,
        }),
        decode: (envelope) =>
          decryptNinebotResponsePayloadCandidateWeb({ envelope, keyData: material.keyData }),
      };
    },
  };
};
