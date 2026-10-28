import {
  createMemoryNinebotAuthSessionStore,
  NinebotAuthSessionManager,
  PassportLoginBusinessError,
  PassportLoginHttpError,
  NinebotPassportRedirectError,
  NinebotHttpError,
  NinebotTelemetryBusinessError,
  NinebotAuthSessionUnavailableError,
} from "@jiuhao/ninebot-client/node";
import type { NinebotAuthProvider, NinebotAuthSession } from "@jiuhao/ninebot-client/node";
import type { RuntimeSecurityStatus } from "../shared/contracts.js";
import { describe, expect, it, vi } from "vitest";
import {
  createNinebotSdkAppClient,
  normalizeSdkAuthError,
  normalizeSdkReadError,
} from "./sdk-app-client.js";
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

  it("classifies one profile failure without retry, even when the diagnostic sink throws", async () => {
    const whoami = vi.fn(async () => {
      throw new PassportLoginHttpError(503);
    });
    const auth = new NinebotAuthSessionManager({
      store: createMemoryNinebotAuthSessionStore(session),
      provider: {
        loginWithPassword: async () => session,
        requestSmsCode: async () => undefined,
        loginWithSmsCode: async () => session,
        whoami,
      },
    });
    await auth.restore();
    const observer = vi.fn((_failure: unknown) => {
      throw new Error("synthetic-private");
    });
    const client = createNinebotSdkAppClient({
      auth,
      vehicleReader: { vehicles: async () => [] },
      telemetryReader: { vehicleStatus: async () => ({}), battery: async () => ({}) },
      travelReader: { rides: async () => ({}), rideDetail: async () => ({}) },
      diagnostics: async () => ({}) as RuntimeSecurityStatus,
      onProfileFailure: observer,
    });
    await expect(client.whoami()).rejects.toMatchObject({ kind: "upstream" });
    expect(whoami).toHaveBeenCalledOnce();
    expect(observer).toHaveBeenCalledOnce();
    expect(observer.mock.calls[0]?.[0]).toMatchObject({
      kind: "http",
      reason: "http-rejected",
      httpStatus: 503,
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
    const smsAbort = new AbortController();
    await client.requestSmsCode("13800138000", "86", "synthetic-validation", smsAbort.signal);
    expect(client.supportsSmsVerification).toBe(true);
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
    expect(provider.requestSmsCode).toHaveBeenCalledWith({
      phone: "13800138000",
      areaCode: "86",
      validate: "synthetic-validation",
      signal: smsAbort.signal,
    });
    expect(vehicleReader.clear).toHaveBeenCalledOnce();
    expect(telemetryReader.clear).toHaveBeenCalledOnce();
    expect(travelReader.clear).toHaveBeenCalledOnce();
  });
});

describe("SDK business read error contract", () => {
  it.each([400, 403, 404, 408, 429, 500, 503])(
    "keeps business HTTP %s recoverable without invalidating credentials",
    (status) => {
      expect(normalizeSdkReadError(new NinebotHttpError(status))).toMatchObject({
        kind: "upstream",
      });
    },
  );
  it("recognizes only explicit HTTP401 and existing typed authentication failures", () => {
    expect(normalizeSdkReadError(new NinebotHttpError(401))).toMatchObject({ kind: "auth" });
    expect(normalizeSdkReadError(new NinebotAuthSessionUnavailableError())).toMatchObject({
      kind: "auth",
    });
    expect(
      normalizeSdkReadError(new PassportLoginBusinessError("90016", "synthetic-private")),
    ).toMatchObject({ kind: "auth" });
  });
  it("does not infer expired credentials from a business code or raw text", () => {
    const errors: unknown[] = [
      new NinebotTelemetryBusinessError("synthetic-private", {
        code: 401,
        data: null,
        desc: "synthetic-private expired token",
        time_cost: null,
        extra: null,
      }),
      new Error("synthetic-private authentication expired HTTP401"),
      new TypeError("synthetic-private fetch failed"),
      "synthetic-private",
    ];
    for (const error of errors) {
      const normalized = normalizeSdkReadError(error);
      expect(normalized).toMatchObject({ kind: "upstream" });
      expect(normalized.message).not.toContain("synthetic-private");
      expect(normalized).not.toHaveProperty("cause");
    }
  });
  it("preserves deliberate app error categories and challenge boundaries", () => {
    for (const kind of ["auth", "verification", "integrity", "unsupported", "upstream"] as const) {
      const error = new NinebotClientError("controlled app message", kind);
      expect(normalizeSdkReadError(error)).toBe(error);
    }
    expect(
      normalizeSdkReadError(new PassportLoginBusinessError(90202, "send code need verify")),
    ).toMatchObject({ kind: "verification" });
  });
  it.each(["vehicles", "vehicleStatus", "battery", "rides", "rideDetail"] as const)(
    "wraps %s at the app boundary without retrying or changing arguments",
    async (operation) => {
      const fail = vi.fn(async () => {
        throw new Error("synthetic-private");
      });
      const auth = new NinebotAuthSessionManager({
        store: createMemoryNinebotAuthSessionStore(),
        provider: {} as NinebotAuthProvider,
      });
      const client = createNinebotSdkAppClient({
        auth,
        vehicleReader: { vehicles: fail },
        telemetryReader: { vehicleStatus: fail, battery: fail },
        travelReader: { rides: fail, rideDetail: fail },
        diagnostics: async () => ({}) as RuntimeSecurityStatus,
      });
      const calls = {
        vehicles: () => client.vehicles(),
        vehicleStatus: () => client.vehicleStatus("synthetic-sn"),
        battery: () => client.battery("synthetic-sn"),
        rides: () => client.rides("synthetic-sn", "202610"),
        rideDetail: () => client.rideDetail("synthetic-sn", "synthetic-ride"),
      };
      await expect(calls[operation]()).rejects.toMatchObject({ kind: "upstream" });
      expect(fail).toHaveBeenCalledOnce();
      const argumentsByOperation = {
        vehicles: [],
        vehicleStatus: ["synthetic-sn"],
        battery: ["synthetic-sn"],
        rides: ["synthetic-sn", "202610"],
        rideDetail: ["synthetic-sn", "synthetic-ride"],
      };
      expect(fail).toHaveBeenCalledWith(...argumentsByOperation[operation]);
    },
  );
});
