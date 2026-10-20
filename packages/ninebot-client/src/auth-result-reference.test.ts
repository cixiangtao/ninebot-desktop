import { describe, expect, it, vi } from "vitest";
import { observeAuthResult } from "./auth-result.ts";
import {
  referenceCurrentTsBusinessResult,
  referenceCurrentTsPassportGate,
  referenceNinecli017BusinessResult,
  referenceNinecli017PassportGate,
} from "./auth-result-reference.ts";
import { createNinebotPassportLoginClient } from "./passport-login-client.ts";

// Recorded send-code gate inputs from fixed ninecli 0.1.7 ARM64, not new executions.
// See docs/AUTH_RESULT_CONTRACT.md for artifact identity, addresses and evidence limits.
const savedSendCases = [
  {
    payload: {
      resultCode: 90000,
    },
    originalGate: "continue",
    evidenceId: "ev_bfb1eb098e25cdf9cac219ad7bfe8257e20715bf39f633863ce8577d9563100c",
    originalExit: 0,
    currentTsGate: "continue",
  },
  {
    payload: {
      resultCode: "90000",
    },
    originalGate: "continue",
    evidenceId: "ev_382307f5db8af31e79a8b90cc458e03fa5b5fe9091b33a522bf8d58a292f47cb",
    originalExit: 0,
    currentTsGate: "continue",
  },
  {
    payload: {
      resultCode: 2,
    },
    originalGate: "continue",
    evidenceId: "ev_46398ff323dbb9ba1c27d20128e94ee05c65ac858cb4595b6ed283bf87638991",
    originalExit: 0,
    currentTsGate: "reject",
  },
  {
    payload: {
      resultCode: "2",
    },
    originalGate: "reject",
    evidenceId: "ev_fa88c1ea24dc551bd72ac95dcfca6e87e206752b8d912e03946df85aa760db1c",
    originalExit: 1,
    currentTsGate: "reject",
  },
  {
    payload: {
      resultCode: 90202,
    },
    originalGate: "continue",
    evidenceId: "ev_07d2775491a643ccd754ef83207525756775ecfd0c31ea6e4c0aafd94abf4186",
    originalExit: 0,
    currentTsGate: "reject",
  },
  {
    payload: {
      resultCode: "90202",
    },
    originalGate: "reject",
    evidenceId: "ev_f02d5f698c072dd27afc54eba064e8d62aeb11225f1887415a276cbd6cb997a1",
    originalExit: 1,
    currentTsGate: "reject",
  },
  {
    payload: {
      code: 0,
      resultCode: "90202",
    },
    originalGate: "reject",
    evidenceId: "ev_3729df52c4ca79bd2e8f75e32c05cc279afa1ac2a4d8bc64c7bd06c3e5435d1e",
    originalExit: 1,
    currentTsGate: "reject",
  },
  {
    payload: {
      code: 1,
      resultCode: "90000",
    },
    originalGate: "reject",
    evidenceId: "ev_c91a7d141949cd8b5dabf89cedd97e4a1cbebd7ee5b45eb94f13a2c9190191b5",
    originalExit: 1,
    currentTsGate: "continue",
  },
  {
    payload: {
      code: "90000",
      resultCode: "90000",
    },
    originalGate: "continue",
    evidenceId: "ev_25a60ac6046411f751ebbde87a39f7dc34f4db25352b4905d1dedab99753c529",
    originalExit: 0,
    currentTsGate: "continue",
  },
  {
    payload: {
      resultCode: "0",
    },
    originalGate: "reject",
    evidenceId: "ev_35eb2a400de243e2a14757a7d8d448a2b7d480bae82a1652b1c3b3097b1bff5a",
    originalExit: 1,
    currentTsGate: "continue",
  },
] as const;

describe("fixed original Passport gate reference", () => {
  it.each(savedSendCases)(
    "matches saved original record $evidenceId",
    ({ payload, originalGate, originalExit }) => {
      expect(referenceNinecli017PassportGate(observeAuthResult("send-code", payload))).toBe(
        originalGate,
      );
      expect(originalExit).toBe(originalGate === "continue" ? 0 : 1);
    },
  );

  it.each(savedSendCases)(
    "compares the current password gate offline for $evidenceId",
    async ({ payload, currentTsGate }) => {
      const response = {
        ...payload,
        data: { access_token: "synthetic-access", refresh_token: "synthetic-refresh" },
      };
      const observation = observeAuthResult("password", response);
      expect(referenceCurrentTsPassportGate(observation)).toBe(currentTsGate);
      const send = vi.fn().mockResolvedValue({
        status: 200,
        headers: {},
        body: new TextEncoder().encode(JSON.stringify(response)),
      });
      const client = createNinebotPassportLoginClient({
        transport: { send },
        signer: () => "synthetic-signature",
      });
      const operation = client.loginWithPassword({
        areaCode: "86",
        username: "synthetic-user",
        password: "synthetic-password",
      });
      if (currentTsGate === "continue")
        await expect(operation).resolves.toMatchObject({ accessToken: "synthetic-access" });
      else await expect(operation).rejects.toThrow();
      expect(send).toHaveBeenCalledTimes(1); // Entirely injected; no real HTTP or accounts.
    },
  );

  it("does not claim implementations or reconstructed branches that do not exist", () => {
    expect(referenceCurrentTsPassportGate(observeAuthResult("send-code", {}))).toBe("unavailable");
    expect(referenceCurrentTsPassportGate(observeAuthResult("consume-code", {}))).toBe(
      "unavailable",
    );
    expect(referenceNinecli017PassportGate(observeAuthResult("profile", {}))).toBe("unavailable");
  });

  it.each([true, [], {}, null])(
    "preserves original unchecked resultCode types %j",
    (resultCode) => {
      expect(referenceNinecli017PassportGate(observeAuthResult("refresh", { resultCode }))).toBe(
        "continue",
      );
    },
  );

  it("keeps current TS shape checks separate from original gate behavior", () => {
    const response = observeAuthResult("password", { resultCode: 90000, resultDesc: 7 });
    expect(referenceNinecli017PassportGate(response)).toBe("continue");
    expect(referenceCurrentTsPassportGate(response)).toBe("invalid-input");
  });
});

describe("Business response references (static predictions, not original executions)", () => {
  it.each([
    [1, "fixture", "accepted-material", "accepted-material"],
    [0, "fixture", "accepted-material", "reject"],
    ["1", "fixture", "reject", "accepted-material"],
    ["0", "fixture", "reject", "reject"],
    [null, "fixture", "reject", "reject"],
    [true, "fixture", "reject", "reject"],
    [1, " ", "accepted-material", "reject"],
    [1, "", "reject", "reject"],
    [1, 7, "reject", "reject"],
  ] as const)("compares code %j / UID %j", (code, uid, original, current) => {
    const observed = observeAuthResult("business-login", { code, data: { uid } });
    expect(referenceNinecli017BusinessResult(observed)).toBe(original);
    expect(referenceCurrentTsBusinessResult(observed)).toBe(current);
  });

  it("never promotes a Passport UID into a Business result", () => {
    expect(
      referenceNinecli017BusinessResult(
        observeAuthResult("password", { code: 1, data: { uid: "fixture" } }),
      ),
    ).toBe("unavailable");
    expect(
      referenceCurrentTsBusinessResult(
        observeAuthResult("business-login", { code: 1, data: { business_uid: "fixture" } }),
      ),
    ).toBe("reject");
  });
});
