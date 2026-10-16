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
import type { NinebotPassportSession } from "./auth.ts";
import { createNinebotPassportWebSigner } from "./passport-signer.ts";

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
  /** Optional override for protocol tests or a future Passport version. */
  signer?: BuildPasswordLoginRequestOptions["signer"];
  refreshSigner?: BuildRefreshRequestOptions["signer"];
  whoamiSigner?: BuildPassportWhoamiRequestOptions["signer"];
  authorizationFactory?: (session: NinebotPassportSession) => string;
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

/** Categories inferred only from explicit server descriptions, not undocumented codes. */
export type PassportRejectionKind =
  | "human-verification"
  | "invalid-credentials"
  | "rate-limited"
  | "unknown";

const classifyRejection = (description: string | null): PassportRejectionKind => {
  const text = description ?? "";
  if (
    /captcha|human[\s-]*(?:verification|check)|人机(?:验证|校验)|滑块(?:验证|校验)|易盾|yidun|send code need verify/i.test(
      text,
    )
  ) {
    return "human-verification";
  }
  if (
    /too many (?:attempts|requests)|rate[\s-]*limit|请求过于频繁|操作太频繁|尝试次数过多/i.test(
      text,
    )
  ) {
    return "rate-limited";
  }
  if (
    /(?:invalid|incorrect|wrong) (?:password|credentials)|password (?:is )?(?:invalid|incorrect|wrong)|密码(?:错误|不正确)|用户名或密码错误/i.test(
      text,
    )
  ) {
    return "invalid-credentials";
  }
  return "unknown";
};

/** Preserves the business code and a bounded category without retaining upstream text/data. */
export class PassportLoginBusinessError extends Error {
  readonly resultCode: number | string | null;
  readonly rejection: PassportRejectionKind;

  constructor(resultCode: number | string | null, resultDesc: string | null) {
    const rejection = classifyRejection(resultDesc);
    super(`Ninebot passport request rejected: ${rejection}`);
    this.name = "PassportLoginBusinessError";
    this.resultCode = resultCode;
    this.rejection = rejection;
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
  resultCode === null ||
  resultCode === 0 ||
  resultCode === "0" ||
  resultCode === 90000 ||
  resultCode === "90000";

/** Creates a transport-backed Passport password-login client. */
export const createNinebotPassportLoginClient = ({
  transport,
  signer,
  refreshSigner,
  whoamiSigner,
  authorizationFactory,
  responseBodyDecoder = (response) => response.body,
}: PassportLoginClientOptions) => {
  const defaultSigners = createNinebotPassportWebSigner();
  const loginSigner = signer ?? defaultSigners.login;
  const refreshRequestSigner = refreshSigner ?? defaultSigners.refresh;
  const whoamiRequestSigner = whoamiSigner ?? defaultSigners.whoami;
  // Passport's /v5/user endpoint expects the JWT as the raw Authorization value.
  // It is deliberately not prefixed with `Bearer`; ninecli sends the token verbatim.
  const authorization =
    authorizationFactory ?? ((session: NinebotPassportSession) => session.accessToken);
  return {
    async loginWithPassword(
      input: Omit<BuildPasswordLoginRequestOptions, "signer">,
    ): Promise<NinebotPassportSession> {
      const request = await buildPasswordLoginRequest({ ...input, signer: loginSigner });
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
    async refresh(session: NinebotPassportSession): Promise<NinebotPassportSession> {
      const request = await buildRefreshRequest({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken ?? "",
        signer: refreshRequestSigner,
      });
      const response = await transport.send(request);
      if (response.status < 200 || response.status >= 300) {
        throw new PassportLoginHttpError(response.status);
      }
      const envelope = parseResponseEnvelope(await responseBodyDecoder(response));
      if (!isSuccessCode(envelope.resultCode)) {
        throw new PassportLoginBusinessError(envelope.resultCode, envelope.resultDesc);
      }
      return parsePassportRefreshSession(envelope.data, session);
    },
    async whoami<T = unknown>(session: NinebotPassportSession): Promise<T> {
      const request = await buildWhoamiPassportRequest({
        authorization: authorization(session),
        signer: whoamiRequestSigner,
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
  };
};

export type NinebotPassportLoginClient = ReturnType<typeof createNinebotPassportLoginClient>;
