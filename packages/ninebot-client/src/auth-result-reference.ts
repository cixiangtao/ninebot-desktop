/** Offline behavior references, deliberately separate from production acceptance policy. */
import type { AuthCodeObservation, AuthResultObservation } from "./auth-result.ts";

export type AuthGateReference = "continue" | "reject" | "invalid-input" | "unavailable";
export type AuthBusinessReference =
  | "accepted-material"
  | "reject"
  | "invalid-input"
  | "unavailable";

/**
 * Fixed ninecli 0.1.7 ARM64 gate, not desired product behavior. Static branches:
 * password 0x10031db5c, send 0x10031e340, consume 0x10031e710, refresh 0x10027e5e0.
 * Ten saved original executions cover send-code only; profile is not reconstructed here.
 */
export const referenceNinecli017PassportGate = (
  input: AuthResultObservation,
): AuthGateReference => {
  if (input.operation === "profile" || input.operation === "business-login") return "unavailable";
  if (
    input.envelope !== "object" ||
    input.code.kind === "other" ||
    input.resultCode.kind === "other"
  ) {
    return "invalid-input";
  }
  if (input.code.kind === "number" && input.code.value !== 0) return "reject";
  if (
    input.code.kind === "string" &&
    input.code.value !== "" &&
    input.code.value !== "0" &&
    input.code.value !== "90000"
  )
    return "reject";
  if (input.resultCode.kind === "string" && input.resultCode.value !== "90000") return "reject";
  return "continue";
};

/** Current TS password/refresh/profile gate only; this reference does not model SMS. */
export const referenceCurrentTsPassportGate = (input: AuthResultObservation): AuthGateReference => {
  if (
    input.operation === "send-code" ||
    input.operation === "consume-code" ||
    input.operation === "business-login"
  ) {
    return "unavailable";
  }
  if (input.envelope !== "object" || input.resultDescription === "invalid") return "invalid-input";
  const top = input.code;
  if (top.kind !== "missing" && top.kind !== "null") {
    if (top.kind !== "number" && top.kind !== "string") return "invalid-input";
    if (top.value !== 0 && top.value !== "0" && top.value !== 90000 && top.value !== "90000")
      return "reject";
  }
  const code = input.resultCode;
  if (code.kind === "missing" || code.kind === "null") return "continue";
  if (code.kind !== "number" && code.kind !== "string") return "invalid-input";
  return code.value === 0 || code.value === "0" || code.value === 90000 || code.value === "90000"
    ? "continue"
    : "reject";
};

const businessResult = (
  input: AuthResultObservation,
  accepts: (code: AuthCodeObservation) => boolean,
  rejectBlank: boolean,
): AuthBusinessReference => {
  if (input.operation !== "business-login") return "unavailable";
  if (input.envelope !== "object") return "invalid-input";
  if (!accepts(input.code) || input.dataShape !== "object") return "reject";
  return input.fields.uid === "present" || (!rejectBlank && input.fields.uid === "blank")
    ? "accepted-material"
    : "reject";
};

/** Static 0x10027c4ec..0x10027c594: numeric 0/1 and nonempty string UID, no trim. */
export const referenceNinecli017BusinessResult = (input: AuthResultObservation) =>
  businessResult(
    input,
    (code) => code.kind === "number" && (code.value === 0 || code.value === 1),
    false,
  );

/** Current business-session-node response check only; input credentials/bootstrap are outside scope. */
export const referenceCurrentTsBusinessResult = (input: AuthResultObservation) =>
  businessResult(
    input,
    (code) =>
      (code.kind === "number" && code.value === 1) ||
      (code.kind === "string" && code.value === "1"),
    true,
  );
