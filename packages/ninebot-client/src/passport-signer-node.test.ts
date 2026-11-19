import { describe, expect, it } from "vitest";
import { buildPasswordLoginRequest } from "./passport-auth.ts";
import { createNinebotPassportSigner } from "./passport-signer-node.ts";

describe("Passport SHA-256 signer", () => {
  it("matches the captured ninecli login signature", async () => {
    const request = await buildPasswordLoginRequest({
      areaCode: "+86",
      username: "probe-user",
      password: "probe-password",
      timestampMs: 1_788_418_017_341,
      signer: createNinebotPassportSigner().login,
    });
    expect(request.headers.sign).toBe(
      "2e1efd9fea589ec6c03e91b386eb30b8c9bbaa8bf4256c78ec5cca7c4c09ab40",
    );
  });
});
