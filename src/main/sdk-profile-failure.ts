import {
  NinebotAuthSessionUnavailableError,
  PassportRefreshMaterialError,
  PassportLoginHttpError,
  PassportLoginBusinessError,
  NinebotPassportRedirectError,
} from "@jiuhao/ninebot-client";

const kinds = [
  "runtime",
  "transport",
  "http",
  "business",
  "protocol",
  "configuration",
  "session",
  "unknown",
] as const;
const reasons = [
  "webcrypto-unavailable",
  "fetch-unavailable",
  "dns",
  "tls",
  "timeout",
  "connection",
  "fetch",
  "http-rejected",
  "business-rejected",
  "redirect",
  "invalid-json",
  "invalid-response",
  "origin-unavailable",
  "runtime-exception",
  "cancelled",
  "session-unavailable",
  "unknown",
] as const;
export interface ProfileFailure {
  kind: (typeof kinds)[number];
  reason: (typeof reasons)[number];
  httpStatus: number | null;
  businessCode: number | null;
}
export const sanitizeProfileFailure = (value: unknown): ProfileFailure => {
  const row = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    kind: kinds.includes(row.kind as ProfileFailure["kind"])
      ? (row.kind as ProfileFailure["kind"])
      : "unknown",
    reason: reasons.includes(row.reason as ProfileFailure["reason"])
      ? (row.reason as ProfileFailure["reason"])
      : "unknown",
    httpStatus:
      typeof row.httpStatus === "number" &&
      Number.isInteger(row.httpStatus) &&
      row.httpStatus >= 100 &&
      row.httpStatus <= 599
        ? row.httpStatus
        : null,
    businessCode:
      typeof row.businessCode === "number" &&
      Number.isInteger(row.businessCode) &&
      row.businessCode >= 0 &&
      row.businessCode <= 999999
        ? row.businessCode
        : null,
  };
};
export const classifyProfileFailure = (error: unknown): ProfileFailure => {
  let kind: ProfileFailure["kind"] = "unknown";
  let reason: ProfileFailure["reason"] = "unknown";
  let httpStatus: number | null = null;
  let businessCode: number | null = null;
  if (error instanceof PassportLoginHttpError) {
    kind = "http";
    reason = "http-rejected";
    httpStatus = error.status;
  } else if (error instanceof PassportLoginBusinessError) {
    kind = "business";
    reason = "business-rejected";
    businessCode = error.resultCode === null ? null : Number(error.resultCode);
  } else if (error instanceof NinebotPassportRedirectError) {
    kind = "protocol";
    reason = "redirect";
    httpStatus = error.status;
  } else if (
    error instanceof NinebotAuthSessionUnavailableError ||
    error instanceof PassportRefreshMaterialError
  ) {
    kind = "session";
    reason = "session-unavailable";
  } else if (
    error instanceof Error &&
    error.message === "Web Crypto SHA-256 is unavailable in this runtime"
  ) {
    kind = "runtime";
    reason = "webcrypto-unavailable";
  } else if (
    error instanceof Error &&
    error.message.startsWith("Missing origin for Ninebot service:")
  ) {
    kind = "configuration";
    reason = "origin-unavailable";
  } else if (error instanceof Error && error.message.startsWith("Ninebot passport response ")) {
    kind = "protocol";
    reason = "invalid-response";
  } else if (
    error instanceof Error &&
    /^Ninebot fetch timed out after \d+ ms$/.test(error.message)
  ) {
    kind = "transport";
    reason = "timeout";
  } else if (error instanceof Error && error.name === "AbortError") {
    kind = "transport";
    reason = "cancelled";
  } else if (error instanceof ReferenceError) {
    kind = "runtime";
    reason = "runtime-exception";
  } else if (error instanceof SyntaxError) {
    kind = "protocol";
    reason = "invalid-json";
  } else if (error instanceof TypeError) {
    if (typeof globalThis.fetch !== "function") {
      kind = "runtime";
      reason = "fetch-unavailable";
    } else {
      kind = "transport";
      const cause =
        error.cause !== null && typeof error.cause === "object"
          ? (error.cause as { code?: unknown })
          : {};
      const code = cause.code;
      reason =
        code === "ENOTFOUND" || code === "EAI_AGAIN"
          ? "dns"
          : [
                "CERT_HAS_EXPIRED",
                "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
                "SELF_SIGNED_CERT_IN_CHAIN",
                "DEPTH_ZERO_SELF_SIGNED_CERT",
              ].includes(String(code))
            ? "tls"
            : code === "UND_ERR_CONNECT_TIMEOUT" || code === "ETIMEDOUT"
              ? "timeout"
              : code === "ECONNREFUSED" || code === "ECONNRESET"
                ? "connection"
                : "fetch";
      if (
        reason === "fetch" &&
        error.message !== "fetch failed" &&
        error.message !== "Failed to fetch"
      ) {
        kind = "runtime";
        reason = "runtime-exception";
      }
    }
  }
  return sanitizeProfileFailure({ kind, reason, httpStatus, businessCode });
};
