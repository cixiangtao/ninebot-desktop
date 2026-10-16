import { describe, expect, it, vi } from "vitest";
import {
  createNinebotPassportAuthProvider,
  NinebotHumanVerificationRequiredError,
} from "./passport-auth-provider.ts";
import type { NinebotAuthSession } from "./auth.ts";
import type { NinebotPassportAuthClient } from "./passport-auth-provider.ts";

const session: NinebotAuthSession = {
  accessToken: "access",
  businessUid: "uid",
  refreshToken: "refresh",
};

describe("Passport auth provider", () => {
  it("maps password login, refresh, and whoami to the shared provider contract", async () => {
    const client = {
      loginWithPassword: vi.fn(async () => session),
      refresh: vi.fn(async () => ({ ...session, accessToken: "next-access" })),
      whoami: vi.fn(async () => ({ username: "rider" })) as NinebotPassportAuthClient["whoami"],
    } satisfies NinebotPassportAuthClient;
    const initializeBusinessSession = vi.fn(async () => "business-only-uid");
    const provider = createNinebotPassportAuthProvider(client, { initializeBusinessSession });

    await expect(
      provider.loginWithPassword({ areaCode: "86", user: "rider", password: "secret" }),
    ).resolves.toEqual({ ...session, businessUid: "business-only-uid" });
    expect(initializeBusinessSession).toHaveBeenCalledWith(session);
    await expect(provider.refresh?.(session)).resolves.toMatchObject({
      accessToken: "next-access",
    });
    await expect(provider.whoami(session)).resolves.toEqual({ username: "rider" });
    expect(client.loginWithPassword).toHaveBeenCalledWith({
      areaCode: "86",
      username: "rider",
      password: "secret",
    });
    expect(client.refresh).toHaveBeenCalledWith(session);
    expect(client.whoami).toHaveBeenCalledWith(session);
  });

  it("exposes SMS human verification as a stable fail-closed error", async () => {
    const provider = createNinebotPassportAuthProvider(
      {
        loginWithPassword: async () => session,
        refresh: async () => session,
        whoami: async <T>() => null as T,
      },
      { initializeBusinessSession: async () => "uid" },
    );

    await expect(
      provider.requestSmsCode({ areaCode: "86", phone: "13800138000" }),
    ).rejects.toBeInstanceOf(NinebotHumanVerificationRequiredError);
    await expect(
      provider.loginWithSmsCode({ areaCode: "86", phone: "13800138000", code: "123456" }),
    ).rejects.toMatchObject({ code: "HUMAN_VERIFICATION_REQUIRED" });
  });

  it("requires business bootstrap even when the account client returns a uid", async () => {
    const provider = createNinebotPassportAuthProvider(
      {
        loginWithPassword: async () => session,
        refresh: async () => session,
        whoami: async <T>() => null as T,
      },
      {
        initializeBusinessSession: async () => {
          throw new Error("bootstrap failed");
        },
      },
    );
    await expect(
      provider.loginWithPassword({ areaCode: "86", user: "rider", password: "secret" }),
    ).rejects.toThrow("bootstrap failed");
  });
});
