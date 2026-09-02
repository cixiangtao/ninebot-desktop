import type { NinebotRequest } from "./transport.ts";

const WHOAMI_BODY = new TextEncoder().encode("{}");

export interface WhoamiSigningInput {
  method: "POST";
  path: "/v5/user";
  timestamp: string;
  clientId: string;
  body: Uint8Array;
}

/** Signature injection point; the canonicalization is intentionally not guessed. */
export type NinebotRequestSigner = (input: WhoamiSigningInput) => string | Promise<string>;

export interface BuildWhoamiRequestOptions {
  authorization: string;
  clientId: string;
  appVersion: string;
  os: string;
  osLanguage: string;
  osVersion: string;
  userAgent?: string;
  timestampMs?: number;
  signer: NinebotRequestSigner;
}

/** Builds the observed passport request while leaving signing to a verified implementation. */
export const buildWhoamiRequest = async ({
  authorization,
  clientId,
  appVersion,
  os,
  osLanguage,
  osVersion,
  userAgent = "ninebot-client",
  timestampMs = Date.now(),
  signer,
}: BuildWhoamiRequestOptions): Promise<NinebotRequest> => {
  const timestamp = String(timestampMs);
  const sign = await signer({
    method: "POST",
    path: "/v5/user",
    timestamp,
    clientId,
    body: WHOAMI_BODY,
  });
  return {
    service: "passport",
    method: "POST",
    path: "/v5/user",
    headers: {
      accept: "application/json",
      "accept-encoding": "gzip",
      app_version: appVersion,
      authorization,
      clientid: clientId,
      "content-type": "application/json",
      os,
      os_language: osLanguage,
      os_version: osVersion,
      sign,
      timestamp,
      "user-agent": userAgent,
    },
    body: WHOAMI_BODY.slice(),
  };
};

export const whoamiRequestBody = () => WHOAMI_BODY.slice();
