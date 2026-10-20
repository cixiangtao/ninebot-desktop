import { describe, expect, it } from "vitest";
import {
  assessAuthResult,
  observeAuthResult,
  type AuthCodeFieldPolicy,
  type AuthResultPolicy,
} from "./auth-result.ts";

// Synthetic test policy only. These choices are not exported production defaults.
const checked = (successCodes: readonly (number | string)[]): AuthCodeFieldPolicy => ({
  mode: "check",
  successCodes,
  challengeCodes: [],
  missing: "allow",
  null: "ambiguous",
  unknown: "reject",
});
const passwordPolicy: AuthResultPolicy = {
  operation: "password",
  code: checked([0, "0"]),
  resultCode: checked([90000, "90000"]),
  conflictingCodes: "ambiguous",
  allowUnmarkedSuccess: false,
  validateResultDescription: true,
  requireDataObject: true,
  requiredFields: ["access_token", "refresh_token"],
  rejectBlankFields: true,
};
const material = { access_token: "synthetic-access", refresh_token: "synthetic-refresh" };
const assess = (payload: unknown, policy = passwordPolicy) =>
  assessAuthResult(observeAuthResult(policy.operation, payload), policy);

describe("auth result observations", () => {
  it.each([null, [], "text", 1, true, undefined])("rejects a non-object envelope %j", (value) => {
    expect(assess(value)).toMatchObject({ outcome: "invalid-response", reason: "envelope" });
  });

  it("distinguishes missing, null and numeric/string codes without coercion", () => {
    expect(observeAuthResult("password", {}).code).toEqual({ kind: "missing" });
    expect(observeAuthResult("password", { code: null }).code).toEqual({ kind: "null" });
    expect(observeAuthResult("password", { code: 0 }).code).toEqual({ kind: "number", value: 0 });
    expect(observeAuthResult("password", { code: "0" }).code).toEqual({
      kind: "string",
      value: "0",
    });
  });

  it.each([
    [true, "boolean"],
    [[], "array"],
    [{}, "object"],
    [undefined, "other"],
    [Infinity, "other"],
  ] as const)("records unsupported code type %j", (code, kind) => {
    expect(observeAuthResult("password", { code }).code).toEqual({ kind });
    expect(assess({ code, resultCode: 90000, data: material }).outcome).toBe("invalid-response");
  });

  it("does not retain upstream descriptions, tokens, UID or arbitrary code strings", () => {
    const marker = "SYNTHETIC_PRIVATE_MATERIAL";
    const payload = Object.freeze({
      code: marker,
      resultCode: "12345678901",
      resultDesc: marker,
      data: Object.freeze({
        access_token: marker,
        refresh_token: marker,
        uid: marker,
        extra: marker,
      }),
    });
    const observed = observeAuthResult("password", payload);
    expect(observed.code).toEqual({ kind: "string", value: null });
    expect(observed.resultCode).toEqual({ kind: "string", value: null });
    expect(JSON.stringify(observed)).not.toContain(marker);
    expect(JSON.stringify(assessAuthResult(observed, passwordPolicy))).not.toContain(marker);
    expect(payload.data.access_token).toBe(marker);
  });

  it.each([1.5, 1_000_000_000, -1_000_000_000])("bounds numeric diagnostics %s", (code) => {
    expect(observeAuthResult("password", { code }).code).toEqual({ kind: "number", value: null });
  });

  it.each([
    [{}, "missing"],
    [{ uid: null }, "wrong-type"],
    [{ uid: 1 }, "wrong-type"],
    [{ uid: "" }, "empty"],
    [{ uid: " \t" }, "blank"],
    [{ uid: "fixture" }, "present"],
  ] as const)("observes only field completeness for %j", (data, expected) => {
    expect(observeAuthResult("business-login", { data }).fields.uid).toBe(expected);
  });
});

describe("explicit acceptance policies", () => {
  it("accepts only selected codes and complete requested material", () => {
    expect(assess({ code: 0, resultCode: "90000", data: material })).toEqual({
      operation: "password",
      outcome: "accepted",
      reason: "accepted",
    });
  });

  it.each([{}, { code: null }])("does not infer success from absent/unknown codes %j", (fields) => {
    expect(assess({ ...fields, data: material }).outcome).toBe("ambiguous");
  });

  it.each(["ambiguous", "reject"] as const)(
    "handles conflicting fields explicitly: %s",
    (choice) => {
      expect(
        assess(
          { code: 1, resultCode: 90000, data: material },
          {
            ...passwordPolicy,
            conflictingCodes: choice,
          },
        ),
      ).toMatchObject({
        outcome: choice === "reject" ? "rejected" : "ambiguous",
        reason: "conflicting-codes",
      });
    },
  );

  it("rejects the numeric SMS error accepted by the original gate", () => {
    expect(assess({ resultCode: 90202, data: material })).toMatchObject({
      outcome: "rejected",
      reason: "code",
    });
  });

  it("requires explicit challenge mapping, not a description heuristic", () => {
    const payload = { resultCode: 90202, resultDesc: "captcha required", data: material };
    expect(assess(payload).outcome).toBe("rejected");
    expect(
      assess(payload, {
        ...passwordPolicy,
        resultCode: {
          ...checked([90000]),
          mode: "check",
          successCodes: [90000],
          challengeCodes: [90202],
          missing: "allow",
          null: "ambiguous",
          unknown: "reject",
        },
      }),
    ).toMatchObject({ outcome: "challenge-required", reason: "challenge-code" });
  });

  it("does not let a challenge hide a conflicting success field", () => {
    expect(
      assess(
        { code: 0, resultCode: 90202 },
        {
          ...passwordPolicy,
          resultCode: {
            mode: "check",
            successCodes: [90000],
            challengeCodes: [90202],
            missing: "allow",
            null: "ambiguous",
            unknown: "reject",
          },
        },
      ),
    ).toMatchObject({ outcome: "ambiguous", reason: "conflicting-codes" });
  });

  it.each([
    [{ resultCode: 90000 }, "data-shape"],
    [{ resultCode: 90000, data: [] }, "data-shape"],
    [{ resultCode: 90000, data: { access_token: "a" } }, "material"],
    [{ resultCode: 90000, data: { ...material, refresh_token: " " } }, "material"],
  ] as const)("keeps envelope acceptance separate from material checks: %j", (payload, reason) => {
    expect(assess(payload)).toMatchObject({ outcome: "invalid-response", reason });
  });

  it("does not hide a rejection behind missing material", () => {
    expect(assess({ resultCode: 90202 })).toMatchObject({ outcome: "rejected", reason: "code" });
  });

  it("can leave Business code zero undecided without selecting either implementation", () => {
    const policy: AuthResultPolicy = {
      ...passwordPolicy,
      operation: "business-login",
      code: {
        mode: "check",
        successCodes: [],
        challengeCodes: [],
        missing: "ambiguous",
        null: "ambiguous",
        unknown: "ambiguous",
      },
      resultCode: { mode: "ignore" },
      requiredFields: ["uid"],
    };
    for (const code of [0, 1, "1"]) {
      expect(assess({ code, data: { uid: "fixture" } }, policy).outcome).toBe("ambiguous");
    }
    // A caller can exercise candidate branches without exporting a production default.
    expect(
      assess(
        { code: 0, data: { uid: "fixture" } },
        {
          ...policy,
          code: checked([0]),
        },
      ).outcome,
    ).toBe("accepted");
    expect(
      assess(
        { code: 0, data: { uid: "fixture" } },
        {
          ...policy,
          code: checked([1]),
        },
      ).outcome,
    ).toBe("rejected");
  });

  it("makes whitespace and material-stage requirements explicit", () => {
    const payload = { resultCode: 90000, data: { ...material, uuid: " " } };
    expect(assess(payload).outcome).toBe("accepted");
    expect(
      assess(payload, {
        ...passwordPolicy,
        requiredFields: ["access_token", "refresh_token", "uuid"],
      }).reason,
    ).toBe("material");
    expect(
      assess(payload, { ...passwordPolicy, requiredFields: ["uuid"], rejectBlankFields: false })
        .outcome,
    ).toBe("accepted");
  });

  it("does not allow two ignored fields to accidentally establish success", () => {
    const policy: AuthResultPolicy = {
      ...passwordPolicy,
      code: { mode: "ignore" },
      resultCode: { mode: "ignore" },
    };
    expect(assess({ data: material }, policy).reason).toBe("missing-success-code");
    expect(assess({ data: material }, { ...policy, allowUnmarkedSuccess: true }).outcome).toBe(
      "accepted",
    );
  });

  it("validates description shape only when the caller selects that contract", () => {
    const payload = { resultCode: 90000, resultDesc: 7, data: material };
    expect(assess(payload).reason).toBe("description-type");
    expect(assess(payload, { ...passwordPolicy, validateResultDescription: false }).outcome).toBe(
      "accepted",
    );
  });

  it("rejects mismatched operation and overlapping or unbounded policy codes", () => {
    expect(() => assessAuthResult(observeAuthResult("send-code", {}), passwordPolicy)).toThrow(
      "operation",
    );
    for (const resultCode of [
      {
        mode: "check",
        successCodes: [90000],
        challengeCodes: [90000],
        missing: "allow",
        null: "allow",
        unknown: "reject",
      },
      {
        mode: "check",
        successCodes: ["private-string"],
        challengeCodes: [],
        missing: "allow",
        null: "allow",
        unknown: "reject",
      },
    ] satisfies AuthCodeFieldPolicy[]) {
      expect(() => assess({}, { ...passwordPolicy, resultCode })).toThrow(
        "invalid or overlapping codes",
      );
    }
  });
});
