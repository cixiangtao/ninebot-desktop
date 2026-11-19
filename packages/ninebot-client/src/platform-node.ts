import {
  buildNinebotEncryptedRequestCandidate,
  decryptNinebotResponsePayloadCandidate,
  generateNinebotCandidateRequestMaterial,
} from "./crypto-codec.ts";
import { generateNinebotNonce } from "./crypto-node.ts";
import { createNinebotPassportSigner } from "./passport-signer-node.ts";
import { ninebotCandidateRsaPublicKeyPem } from "./protocol-public-key.ts";
import type { NinebotCryptoAdapter, NinebotCryptoAdapterOptions } from "./platform.ts";

/** Node adapter used by CLI/Electron; all protocol orchestration remains shared. */
export const createNinebotNodeCryptoAdapter = ({
  platform = 2,
  p = "101",
  t = "0",
  timeStamp,
  rsaPublicKey = ninebotCandidateRsaPublicKeyPem,
}: NinebotCryptoAdapterOptions = {}): NinebotCryptoAdapter => {
  const signer = createNinebotPassportSigner();
  return {
    nonce: generateNinebotNonce,
    passport: {
      signer: signer.login,
      smsSigner: signer.sms,
      refreshSigner: signer.refresh,
      whoamiSigner: signer.whoami,
    },
    async encode(plaintextBody) {
      const material = generateNinebotCandidateRequestMaterial({
        platform,
        p,
        t,
        ...(timeStamp === undefined ? {} : { timeStamp }),
      });
      return {
        envelope: buildNinebotEncryptedRequestCandidate({ plaintextBody, material, rsaPublicKey }),
        decode: async (envelope) =>
          decryptNinebotResponsePayloadCandidate({ envelope, keyData: material.keyData }),
      };
    },
  };
};
