import type {
  NinebotEncryptedRequestEnvelope,
  NinebotEncryptedResponseEnvelope,
} from "./crypto-envelope.ts";
import type { PassportLoginClientOptions } from "./passport-login-client.ts";
import type { NinebotResponse } from "./transport.ts";

/** One request owns its decryption context; adapters must never share it across requests. */
export interface NinebotEncodedRequest {
  envelope: NinebotEncryptedRequestEnvelope;
  decode(envelope: NinebotEncryptedResponseEnvelope): Promise<Uint8Array>;
}

/** Host-supplied protocol cryptography, independent of Node and Web Crypto globals. */
export interface NinebotCryptoAdapter {
  /** A cryptographically secure 32-character hexadecimal nonce. */
  nonce(): string;
  encode(plaintext: Uint8Array): Promise<NinebotEncodedRequest>;
  passport: Required<
    Pick<PassportLoginClientOptions, "signer" | "smsSigner" | "refreshSigner" | "whoamiSigner">
  >;
}

/** Returns decompressed bytes; transports that decompress automatically may use response.body. */
export type NinebotResponseBodyDecoder = (
  response: NinebotResponse,
) => Uint8Array | Promise<Uint8Array>;

export interface NinebotCryptoAdapterOptions {
  /** Observed wire-protocol platform, independent of the host OS. Defaults to 2. */
  platform?: number;
  p?: string;
  t?: string;
  timeStamp?: number;
  rsaPublicKey?: Uint8Array | string;
}
