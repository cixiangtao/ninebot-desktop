import { describe, expect, it } from "vitest";
import { buildPasswordLoginRequest } from "./passport-auth.ts";
import { createNinebotPassportWebSigner } from "./passport-signer.ts";

describe("browser-compatible Passport signer", () => {
  it("matches the SHA-256 signature without importing node crypto", async () => {
    const request = await buildPasswordLoginRequest({
      areaCode: "+86",
      username: "probe-user",
      password: "probe-password",
      timestampMs: 1_788_418_017_341,
      signer: createNinebotPassportWebSigner().login,
    });
    expect(request.headers.sign).toBe(
      "2e1efd9fea589ec6c03e91b386eb30b8c9bbaa8bf4256c78ec5cca7c4c09ab40",
    );
  });
});
