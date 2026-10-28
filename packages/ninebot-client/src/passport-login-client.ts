import {
  buildRefreshRequest,
  buildPassportSmsRequest,
  type PassportSmsRequestSigner,
  buildPasswordLoginRequest,
  buildWhoamiPassportRequest,
  parsePassportLoginSession,
  parsePassportRefreshSession,
  type BuildPasswordLoginRequestOptions,
  type BuildRefreshRequestOptions,
  type BuildPassportWhoamiRequestOptions,
  type PassportRequest,
} from "./passport-auth.ts";
import type {
  NinebotSmsCodeRequest,
  NinebotSmsLoginInput,
  NinebotPassportSession,
} from "./auth.ts";
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
  smsSigner?: PassportSmsRequestSigner;
  smsRegion?: () => Promise<string>;
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
  | "invalid-request"
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
    /args? missing|missing (?:required )?(?:args?|arguments?|parameters?|fields?)|required (?:argument|parameter|field).*(?:missing|required)|参数(?:缺失|不完整|为空)|缺少(?:必填)?参数/i.test(
      text,
    )
  )
    return "invalid-request";
  if (
    /(?:invalid|incorrect|wrong) (?:password|credentials)|password (?:is )?(?:invalid|incorrect|wrong)|密码(?:错误|不正确)|用户名或密码错误/i.test(
      text,
    )
  ) {
    return "invalid-credentials";
  }
  return "unknown";
};

export type PassportDescriptionSource = "resultDesc" | "desc" | "message" | "none" | "unknown";

/** Reject missing refresh material locally, before any network operation. */
export class PassportRefreshMaterialError extends Error {
  constructor() {
    super("Ninebot passport refresh requires complete credentials");
    this.name = "PassportRefreshMaterialError";
  }
}

/** Preserves the business code and a bounded category without retaining upstream text/data. */
export class PassportLoginBusinessError extends Error {
  readonly resultCode: number | string | null;
  readonly rejection: PassportRejectionKind;
  readonly responseField: "code" | "resultCode";
  readonly descriptionSource: PassportDescriptionSource;

  constructor(
    resultCode: number | string | null,
    resultDesc: string | null,
    responseField: "code" | "resultCode" = "resultCode",
    descriptionSource: PassportDescriptionSource = "unknown",
  ) {
    const rejection = classifyRejection(resultDesc);
    super(`Ninebot passport request rejected: ${rejection}`);
    this.name = "PassportLoginBusinessError";
    this.resultCode =
      typeof resultCode === "number"
        ? Number.isSafeInteger(resultCode) && Math.abs(resultCode) <= 999_999_999
          ? resultCode
          : null
        : typeof resultCode === "string" && /^-?\d{1,9}$/.test(resultCode)
          ? resultCode
          : null;
    this.rejection = rejection;
    this.responseField = responseField;
    this.descriptionSource = descriptionSource;
  }
}

interface PassportResponseEnvelope {
  code: number | string | null;
  data: unknown;
  resultCode: number | string | null;
  resultDesc: string | null;
  descriptionSource: PassportDescriptionSource;
}

const parseResponseEnvelope = (body: Uint8Array): PassportResponseEnvelope => {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Ninebot passport response is not a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const code = record.code;
  if (code !== undefined && code !== null && typeof code !== "number" && typeof code !== "string")
    throw new Error("Ninebot passport response has an invalid code");
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
  const descriptionSource = (["resultDesc", "desc", "message"] as const).find(
    (field) => typeof record[field] === "string" && record[field].trim() !== "",
  );
  return {
    code: code === undefined ? null : code,
    data: record.data,
    resultCode: resultCode === undefined ? null : resultCode,
    resultDesc: descriptionSource === undefined ? null : (record[descriptionSource] as string),
    descriptionSource: descriptionSource ?? "none",
  };
};

const isSuccessCode = (resultCode: number | string | null) =>
  resultCode === null ||
  resultCode === 0 ||
  resultCode === "0" ||
  resultCode === 90000 ||
  resultCode === "90000";

const assertSmsActive = (signal?: AbortSignal) => {
  if (signal?.aborted) throw signal.reason ?? new Error("Ninebot SMS request was cancelled");
};

/** Creates a transport-backed Passport password-login client. */
export const createNinebotPassportLoginClient = ({
  transport,
  signer,
  refreshSigner,
  smsSigner,
  smsRegion,
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
  const sendSmsRequest = async (
    input: NinebotSmsCodeRequest & { code?: string; region?: string },
  ) => {
    const { signal, ...smsInput } = input;
    assertSmsActive(signal);
    const request = await buildPassportSmsRequest({
      ...smsInput,
      signer: smsSigner ?? defaultSigners.sms,
    });
    assertSmsActive(signal);
    const response = await transport.send({
      ...request,
      ...(signal === undefined ? {} : { signal }),
    });
    assertSmsActive(signal);
    if (response.status < 200 || response.status >= 300)
      throw new PassportLoginHttpError(response.status);
    const raw = await responseBodyDecoder(response);
    assertSmsActive(signal);
    const envelope = parseResponseEnvelope(raw);
    const record = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
    if (
      (record.code !== undefined && record.code !== 0 && record.code !== "0") ||
      (envelope.resultCode !== 90000 && envelope.resultCode !== "90000")
    ) {
      throw new PassportLoginBusinessError(
        envelope.resultCode,
        input.code === undefined &&
          (envelope.resultCode === 90202 || envelope.resultCode === "90202")
          ? "send code need verify"
          : envelope.resultDesc,
      );
    }
    return envelope.data;
  };
  return {
    async requestSmsCode(input: NinebotSmsCodeRequest): Promise<void> {
      await sendSmsRequest({
        areaCode: input.areaCode,
        phone: input.phone,
        ...(input.validate === undefined ? {} : { validate: input.validate }),
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      });
    },
    async loginWithSmsCode(
      input: NinebotSmsLoginInput & { region?: string },
    ): Promise<NinebotPassportSession> {
      if (typeof input.code !== "string" || !/^\d{4,8}$/.test(input.code))
        throw new Error("Invalid Passport SMS input");
      return parsePassportLoginSession(
        await sendSmsRequest({
          areaCode: input.areaCode,
          phone: input.phone,
          code: input.code,
          region: input.region ?? (smsRegion ? await smsRegion() : "bj"),
        }),
      );
    },
    async loginWithPassword(
      input: Omit<BuildPasswordLoginRequestOptions, "signer">,
    ): Promise<NinebotPassportSession> {
      const request = await buildPasswordLoginRequest({ ...input, signer: loginSigner });
      const response = await transport.send(request);
      if (response.status < 200 || response.status >= 300) {
        throw new PassportLoginHttpError(response.status);
      }
      const envelope = parseResponseEnvelope(await responseBodyDecoder(response));
      if (!isSuccessCode(envelope.code))
        throw new PassportLoginBusinessError(
          envelope.code,
          envelope.resultDesc,
          "code",
          envelope.descriptionSource,
        );
      if (!isSuccessCode(envelope.resultCode)) {
        throw new PassportLoginBusinessError(
          envelope.resultCode,
          envelope.resultDesc,
          "resultCode",
          envelope.descriptionSource,
        );
      }
      return parsePassportLoginSession(envelope.data);
    },
    async refresh(session: NinebotPassportSession): Promise<NinebotPassportSession> {
      if (
        typeof session.accessToken !== "string" ||
        !session.accessToken.trim() ||
        typeof session.refreshToken !== "string" ||
        !session.refreshToken.trim()
      )
        throw new PassportRefreshMaterialError();
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
      if (!isSuccessCode(envelope.code))
        throw new PassportLoginBusinessError(
          envelope.code,
          envelope.resultDesc,
          "code",
          envelope.descriptionSource,
        );
      if (!isSuccessCode(envelope.resultCode)) {
        throw new PassportLoginBusinessError(
          envelope.resultCode,
          envelope.resultDesc,
          "resultCode",
          envelope.descriptionSource,
        );
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
      if (!isSuccessCode(envelope.code))
        throw new PassportLoginBusinessError(
          envelope.code,
          envelope.resultDesc,
          "code",
          envelope.descriptionSource,
        );
      if (!isSuccessCode(envelope.resultCode)) {
        throw new PassportLoginBusinessError(
          envelope.resultCode,
          envelope.resultDesc,
          "resultCode",
          envelope.descriptionSource,
        );
      }
      return envelope.data as T;
    },
  };
};

export type NinebotPassportLoginClient = ReturnType<typeof createNinebotPassportLoginClient>;
