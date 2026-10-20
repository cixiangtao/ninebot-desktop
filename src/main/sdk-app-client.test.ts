import {
  createMemoryNinebotAuthSessionStore,
  NinebotAuthSessionManager,
  PassportLoginBusinessError,
  NinebotPassportRedirectError,
} from "@jiuhao/ninebot-client";
import type { NinebotAuthProvider, NinebotAuthSession } from "@jiuhao/ninebot-client";
import type { RuntimeSecurityStatus } from "../shared/contracts.js";
import { describe, expect, it, vi } from "vitest";
import { createNinebotSdkAppClient, normalizeSdkAuthError } from "./sdk-app-client.js";
import { NinebotClientError } from "./app-client.js";

const session = { accessToken: "access", businessUid: "uid" };

describe("createNinebotSdkAppClient", () => {
  it("maps Passport expiry failures to the auth error contract", () => {
    const error = normalizeSdkAuthError(new PassportLoginBusinessError("90016", "expired"));
    expect(error).toBeInstanceOf(NinebotClientError);
    expect(error).toMatchObject({ kind: "auth" });
  });

  it("keeps redirects distinct from expired credentials and suppresses destinations", () => {
    const error = normalizeSdkAuthError(new NinebotPassportRedirectError(307));
    expect(error).toBeInstanceOf(NinebotClientError);
    expect(error).toMatchObject({
      kind: "upstream",
      message: "九号认证接口发生重定向，已停止请求，请检查接口配置。",
    });
  });

  it("maps application calls to injected SDK boundaries", async () => {
    const provider = {
      loginWithPassword: vi.fn(async () => session),
      requestSmsCode: vi.fn(async () => undefined),
      loginWithSmsCode: vi.fn(async () => session),
      whoami: vi.fn((async (_session: NinebotAuthSession) => ({
        uid: "uid",
      })) as NinebotAuthProvider["whoami"]),
      refresh: vi.fn(async () => session),
    };
    const auth = new NinebotAuthSessionManager({
      provider: provider as unknown as NinebotAuthProvider,
      store: createMemoryNinebotAuthSessionStore(),
    });
    const vehicleReader = {
      vehicles: vi.fn(async () => [{ wnumber: "SN-1" }]),
      clear: vi.fn(),
    };
    const telemetryReader = {
      vehicleStatus: vi.fn(async () => ({ status: "ok" })),
      battery: vi.fn(async () => ({ battery: 80 })),
      clear: vi.fn(),
    };
    const travelReader = {
      rides: vi.fn(async () => ({ month: "202608" })),
      rideDetail: vi.fn(async () => ({ id: "ride-1" })),
      clear: vi.fn(),
    };
    const diagnostics = vi.fn(async () => ({}) as RuntimeSecurityStatus);
    const client = createNinebotSdkAppClient({
      auth,
      vehicleReader,
      telemetryReader,
      travelReader,
      diagnostics,
    });

    await client.login("user", "86", "password");
    await client.requestSmsCode("13800138000", "86");
    await client.loginWithSmsCode("13800138000", "86", "123456");
    expect(await client.whoami()).toEqual({ uid: "uid" });
    expect(await client.vehicles()).toEqual([{ wnumber: "SN-1" }]);
    expect(await client.vehicleStatus("SN-1")).toEqual({ status: "ok" });
    expect(await client.battery("SN-1")).toEqual({ battery: 80 });
    expect(await client.rides("SN-1", "202608")).toEqual({ month: "202608" });
    expect(await client.rideDetail("SN-1", "ride-1")).toEqual({ id: "ride-1" });
    await client.diagnostics();
    await client.logout();
    client.clear?.();

    expect(provider.loginWithPassword).toHaveBeenCalledWith({
      user: "user",
      areaCode: "86",
      password: "password",
    });
    expect(provider.requestSmsCode).toHaveBeenCalledWith({ phone: "13800138000", areaCode: "86" });
    expect(vehicleReader.clear).toHaveBeenCalledOnce();
    expect(telemetryReader.clear).toHaveBeenCalledOnce();
    expect(travelReader.clear).toHaveBeenCalledOnce();
  });
});
