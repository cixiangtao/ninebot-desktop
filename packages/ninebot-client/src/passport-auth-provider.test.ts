import { describe, expect, it, vi } from "vitest";
import {
  createNinebotPassportAuthProvider,
  NinebotHumanVerificationRequiredError,
} from "./passport-auth-provider.ts";
import type { NinebotAuthSession } from "./auth.ts";

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
      whoami: vi.fn(async () => ({ username: "rider" })),
    };
    const provider = createNinebotPassportAuthProvider(client);

    await expect(
      provider.loginWithPassword({ areaCode: "86", user: "rider", password: "secret" }),
    ).resolves.toEqual(session);
    await expect(provider.refresh?.(session)).resolves.toMatchObject({
      accessToken: "next-access",
    });
    await expect(provider.whoami(session)).resolves.toEqual({ username: "rider" });
    expect(client.loginWithPassword).toHaveBeenCalledWith({
      areaCode: "86",
      user: "rider",
      password: "secret",
    });
    expect(client.refresh).toHaveBeenCalledWith(session);
    expect(client.whoami).toHaveBeenCalledWith(session);
  });

  it("exposes SMS human verification as a stable fail-closed error", async () => {
    const provider = createNinebotPassportAuthProvider({
      loginWithPassword: async () => session,
      refresh: async () => session,
      whoami: async () => null,
    });

    await expect(
      provider.requestSmsCode({ areaCode: "86", phone: "13800138000" }),
    ).rejects.toBeInstanceOf(NinebotHumanVerificationRequiredError);
    await expect(
      provider.loginWithSmsCode({ areaCode: "86", phone: "13800138000", code: "123456" }),
    ).rejects.toMatchObject({ code: "HUMAN_VERIFICATION_REQUIRED" });
  });
});
