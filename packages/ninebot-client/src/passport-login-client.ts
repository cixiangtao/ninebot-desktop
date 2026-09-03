import {
  buildRefreshRequest,
  buildPasswordLoginRequest,
  buildWhoamiPassportRequest,
  parsePassportLoginSession,
  parsePassportRefreshSession,
  type BuildPasswordLoginRequestOptions,
  type BuildRefreshRequestOptions,
  type BuildPassportWhoamiRequestOptions,
  type PassportRequest,
} from "./passport-auth.ts";
import type { NinebotAuthSession } from "./auth.ts";

export interface PassportResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
}

export interface PassportTransport {
  send(request: PassportRequest): Promise<PassportResponse>;
}

export interface PassportLoginClientOptions {
  transport: PassportTransport;
  signer: BuildPasswordLoginRequestOptions["signer"];
  refreshSigner?: BuildRefreshRequestOptions["signer"];
  whoamiSigner?: BuildPassportWhoamiRequestOptions["signer"];
  authorizationFactory?: (session: NinebotAuthSession) => string;
  responseBodyDecoder?: (response: PassportResponse) => Uint8Array | Promise<Uint8Array>;
}

export class PassportLoginHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Ninebot passport login failed with HTTP ${status}`);
    this.name = "PassportLoginHttpError";
    this.status = status;
  }
}

export class PassportLoginBusinessError extends Error {
  readonly resultCode: number | string | null;

  constructor(resultCode: number | string | null, resultDesc: string | null) {
    super(
      resultDesc
        ? `Ninebot passport request failed: ${resultDesc}`
        : "Ninebot passport request failed",
    );
    this.name = "PassportLoginBusinessError";
    this.resultCode = resultCode;
  }
}

interface PassportResponseEnvelope {
  data: unknown;
  resultCode: number | string | null;
  resultDesc: string | null;
}

const parseResponseEnvelope = (body: Uint8Array): PassportResponseEnvelope => {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Ninebot passport response is not a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const resultCode = record.resultCode;
  const resultDesc = record.resultDesc;
  if (
    resultCode !== undefined &&
    resultCode !== null &&
    typeof resultCode !== "number" &&
    typeof resultCode !== "string"
  ) {
    throw new Error("Ninebot passport response has an invalid resultCode");
  }
  if (resultDesc !== undefined && resultDesc !== null && typeof resultDesc !== "string") {
    throw new Error("Ninebot passport response has an invalid resultDesc");
  }
  return {
    data: record.data,
    resultCode: resultCode === undefined ? null : resultCode,
    resultDesc: resultDesc === undefined ? null : resultDesc,
  };
};

const isSuccessCode = (resultCode: number | string | null) =>
  resultCode === null || resultCode === 0 || resultCode === "0";

/** Creates a transport-backed Passport password-login client. */
export const createNinebotPassportLoginClient = ({
  transport,
  signer,
  refreshSigner,
  whoamiSigner,
  authorizationFactory,
  responseBodyDecoder = (response) => response.body,
}: PassportLoginClientOptions) => ({
  async loginWithPassword(
    input: Omit<BuildPasswordLoginRequestOptions, "signer">,
  ): Promise<NinebotAuthSession> {
    const request = await buildPasswordLoginRequest({ ...input, signer });
    const response = await transport.send(request);
    if (response.status < 200 || response.status >= 300) {
      throw new PassportLoginHttpError(response.status);
    }
    const envelope = parseResponseEnvelope(await responseBodyDecoder(response));
    if (!isSuccessCode(envelope.resultCode)) {
      throw new PassportLoginBusinessError(envelope.resultCode, envelope.resultDesc);
    }
    return parsePassportLoginSession(envelope.data);
  },
  async refresh(session: NinebotAuthSession): Promise<NinebotAuthSession> {
    if (!refreshSigner) throw new Error("Passport refresh signer is not configured");
    const request = await buildRefreshRequest({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken ?? "",
      signer: refreshSigner,
    });
    const response = await transport.send(request);
    if (response.status < 200 || response.status >= 300) {
      throw new PassportLoginHttpError(response.status);
    }
    const envelope = parseResponseEnvelope(await responseBodyDecoder(response));
    if (!isSuccessCode(envelope.resultCode)) {
      throw new PassportLoginBusinessError(envelope.resultCode, envelope.resultDesc);
    }
    return parsePassportRefreshSession(envelope.data, session.businessUid);
  },
  async whoami<T = unknown>(session: NinebotAuthSession): Promise<T> {
    if (!whoamiSigner || !authorizationFactory) {
      throw new Error("Passport whoami signer and authorization factory are not configured");
    }
    const request = await buildWhoamiPassportRequest({
      authorization: authorizationFactory(session),
      signer: whoamiSigner,
    });
    const response = await transport.send(request);
    if (response.status < 200 || response.status >= 300) {
      throw new PassportLoginHttpError(response.status);
    }
    const envelope = parseResponseEnvelope(await responseBodyDecoder(response));
    if (!isSuccessCode(envelope.resultCode)) {
      throw new PassportLoginBusinessError(envelope.resultCode, envelope.resultDesc);
    }
    return envelope.data as T;
  },
});

export type NinebotPassportLoginClient = ReturnType<typeof createNinebotPassportLoginClient>;
