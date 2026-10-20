/** Pure response observations; no tokens, descriptions, transport or persistence are retained. */
export type AuthResultOperation =
  | "password"
  | "send-code"
  | "consume-code"
  | "refresh"
  | "profile"
  | "business-login";

/** Values are bounded diagnostic codes, never arbitrary upstream strings. */
export type AuthCodeObservation =
  | { readonly kind: "missing" | "null" | "boolean" | "array" | "object" | "other" }
  | { readonly kind: "number"; readonly value: number | null }
  | { readonly kind: "string"; readonly value: string | null };

export type AuthDataField = "access_token" | "refresh_token" | "uuid" | "uid";
export type AuthTextObservation = "missing" | "wrong-type" | "empty" | "blank" | "present";

export interface AuthResultObservation {
  readonly operation: AuthResultOperation;
  readonly envelope: "object" | "invalid";
  readonly code: AuthCodeObservation;
  readonly resultCode: AuthCodeObservation;
  readonly resultDescription: "missing" | "null" | "string" | "invalid";
  readonly dataShape: "missing" | "null" | "object" | "invalid";
  readonly fields: Readonly<Record<AuthDataField, AuthTextObservation>>;
}

export type AuthDiagnosticCode = number | string;
export type AuthAbsentCodeDecision = "allow" | "reject" | "ambiguous";
export type AuthCodeFieldPolicy =
  | { readonly mode: "ignore" }
  | {
      readonly mode: "check";
      readonly successCodes: readonly AuthDiagnosticCode[];
      readonly challengeCodes: readonly AuthDiagnosticCode[];
      readonly missing: AuthAbsentCodeDecision;
      readonly null: AuthAbsentCodeDecision;
      readonly unknown: "reject" | "ambiguous";
    };

/** No default policy: the caller must state the operation's unresolved choices. */
export interface AuthResultPolicy {
  readonly operation: AuthResultOperation;
  readonly code: AuthCodeFieldPolicy;
  readonly resultCode: AuthCodeFieldPolicy;
  readonly conflictingCodes: "reject" | "ambiguous";
  readonly allowUnmarkedSuccess: boolean;
  readonly validateResultDescription: boolean;
  readonly requireDataObject: boolean;
  readonly requiredFields: readonly AuthDataField[];
  readonly rejectBlankFields: boolean;
}

export interface AuthResultAssessment {
  readonly operation: AuthResultOperation;
  /** Accepted material is not a persisted or vehicle-ready session. */
  readonly outcome:
    | "accepted"
    | "rejected"
    | "challenge-required"
    | "ambiguous"
    | "invalid-response";
  readonly reason:
    | "accepted"
    | "envelope"
    | "code-type"
    | "description-type"
    | "conflicting-codes"
    | "code"
    | "challenge-code"
    | "undecided-code"
    | "missing-success-code"
    | "data-shape"
    | "material";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isDiagnosticCode = (value: unknown): value is AuthDiagnosticCode =>
  typeof value === "number"
    ? Number.isSafeInteger(value) && Math.abs(value) <= 999_999_999
    : typeof value === "string" && (value === "" || /^-?\d{1,9}$/.test(value));

const observeCode = (record: Record<string, unknown>, field: string): AuthCodeObservation => {
  if (!Object.hasOwn(record, field)) return { kind: "missing" };
  const value = record[field];
  if (value === null) return { kind: "null" };
  if (typeof value === "string") {
    return { kind: "string", value: isDiagnosticCode(value) ? value : null };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { kind: "number", value: isDiagnosticCode(value) ? value : null };
  }
  if (typeof value === "boolean") return { kind: "boolean" };
  if (Array.isArray(value)) return { kind: "array" };
  return { kind: isRecord(value) ? "object" : "other" };
};

const observeText = (
  record: Record<string, unknown>,
  field: AuthDataField,
): AuthTextObservation => {
  if (!Object.hasOwn(record, field)) return "missing";
  const value = record[field];
  if (typeof value !== "string") return "wrong-type";
  if (value.length === 0) return "empty";
  return value.trim().length === 0 ? "blank" : "present";
};

/** Observes decoded JSON only. Never returns upstream descriptions, material or extra fields. */
export const observeAuthResult = (
  operation: AuthResultOperation,
  decoded: unknown,
): AuthResultObservation => {
  const record = isRecord(decoded) ? decoded : {};
  const data = isRecord(record.data) ? record.data : {};
  const description = record.resultDesc;
  return {
    operation,
    envelope: isRecord(decoded) ? "object" : "invalid",
    code: observeCode(record, "code"),
    resultCode: observeCode(record, "resultCode"),
    resultDescription: !Object.hasOwn(record, "resultDesc")
      ? "missing"
      : description === null
        ? "null"
        : typeof description === "string"
          ? "string"
          : "invalid",
    dataShape: !Object.hasOwn(record, "data")
      ? "missing"
      : record.data === null
        ? "null"
        : isRecord(record.data)
          ? "object"
          : "invalid",
    fields: {
      access_token: observeText(data, "access_token"),
      refresh_token: observeText(data, "refresh_token"),
      uuid: observeText(data, "uuid"),
      uid: observeText(data, "uid"),
    },
  };
};

type CodeDecision = "accept" | "neutral" | "reject" | "challenge" | "ambiguous" | "invalid";

const checkPolicy = (policy: AuthCodeFieldPolicy) => {
  if (policy.mode === "ignore") return;
  if (
    !policy.successCodes.every(isDiagnosticCode) ||
    !policy.challengeCodes.every(isDiagnosticCode) ||
    policy.successCodes.some((code) => policy.challengeCodes.includes(code))
  ) {
    throw new Error("Auth result policy has invalid or overlapping codes");
  }
};

const decideCode = (value: AuthCodeObservation, policy: AuthCodeFieldPolicy): CodeDecision => {
  if (policy.mode === "ignore") return "neutral";
  if (value.kind === "missing" || value.kind === "null") {
    const decision = policy[value.kind];
    return decision === "allow" ? "neutral" : decision;
  }
  if (value.kind !== "number" && value.kind !== "string") return "invalid";
  if (value.value !== null) {
    if (policy.successCodes.includes(value.value)) return "accept";
    if (policy.challengeCodes.includes(value.value)) return "challenge";
  }
  return policy.unknown;
};

/**
 * Applies only an explicitly supplied policy. Conflict handling precedes material validation;
 * a definite rejection then challenge precedes an undecided field. No upstream action is taken.
 */
export const assessAuthResult = (
  observation: AuthResultObservation,
  policy: AuthResultPolicy,
): AuthResultAssessment => {
  if (observation.operation !== policy.operation) {
    throw new Error("Auth result policy operation does not match observation");
  }
  checkPolicy(policy.code);
  checkPolicy(policy.resultCode);
  const result = (
    outcome: AuthResultAssessment["outcome"],
    reason: AuthResultAssessment["reason"],
  ): AuthResultAssessment => ({ operation: observation.operation, outcome, reason });
  if (observation.envelope !== "object") return result("invalid-response", "envelope");
  if (policy.validateResultDescription && observation.resultDescription === "invalid") {
    return result("invalid-response", "description-type");
  }
  const decisions = new Set([
    decideCode(observation.code, policy.code),
    decideCode(observation.resultCode, policy.resultCode),
  ]);
  if (decisions.has("invalid")) return result("invalid-response", "code-type");
  if (decisions.has("accept") && (decisions.has("reject") || decisions.has("challenge"))) {
    return result(
      policy.conflictingCodes === "reject" ? "rejected" : "ambiguous",
      "conflicting-codes",
    );
  }
  if (decisions.has("reject")) return result("rejected", "code");
  if (decisions.has("challenge")) return result("challenge-required", "challenge-code");
  if (decisions.has("ambiguous")) return result("ambiguous", "undecided-code");
  if (!decisions.has("accept") && !policy.allowUnmarkedSuccess) {
    return result("ambiguous", "missing-success-code");
  }
  if (
    (policy.requireDataObject || policy.requiredFields.length > 0) &&
    observation.dataShape !== "object"
  ) {
    return result("invalid-response", "data-shape");
  }
  if (
    policy.requiredFields.some((field) => {
      const state = observation.fields[field];
      return state !== "present" && !(state === "blank" && !policy.rejectBlankFields);
    })
  ) {
    return result("invalid-response", "material");
  }
  return result("accepted", "accepted");
};
