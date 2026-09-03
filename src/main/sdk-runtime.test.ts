import {
  createMemoryNinebotAuthSessionStore,
  NinebotAuthSessionManager,
} from "@jiuhao/ninebot-client";
import { describe, expect, it } from "vitest";
import { createSdkRuntimeDiagnostics } from "./sdk-runtime.js";

describe("SDK runtime diagnostics", () => {
  it("reports an in-memory credential boundary without a ninecli binary", async () => {
    const auth = new NinebotAuthSessionManager({
      provider: {
        loginWithPassword: async () => ({ accessToken: "a", businessUid: "u" }),
        requestSmsCode: async () => undefined,
        loginWithSmsCode: async () => ({ accessToken: "a", businessUid: "u" }),
        whoami: async <T>() => null as T,
      },
      store: createMemoryNinebotAuthSessionStore(),
    });
    const status = await createSdkRuntimeDiagnostics({
      configDirectory: "/tmp/ninebot-sdk-runtime",
      auth,
    })();

    expect(status.version).toBe("typescript-sdk");
    expect(status.binary.status).toBe("unsupported");
    expect(status.policy.allowedCommands).toEqual([]);
    expect(status.policy.passwordTransport).toBe("in-memory-call");
    expect(status.storage.tokensPresent).toBe(false);
  });
});
