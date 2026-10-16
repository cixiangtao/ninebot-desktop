import { describe, expect, it, vi } from "vitest";
import {
  createMemoryNinebotAuthSessionStore,
  NinebotAuthSessionManager,
  NinebotHttpError,
  PassportLoginBusinessError,
  type NinebotAuthProvider,
  type NinebotCandidateSessionClient,
  type NinebotCandidateSessionFields,
} from "@jiuhao/ninebot-client";
import { runNinebotAuthAcceptance, type AuthAcceptanceOptions } from "./auth-acceptance-core.ts";
import { parseAuthAcceptanceArguments, parseAuthAcceptanceCredentials } from "./auth-acceptance.ts";

const secret = "synthetic-private-marker";
const credentials = { user: secret, password: secret, areaCode: "86" };
const device = { deviceId: secret, osVersion: "13", osModel: "Xiaomi", region: "bj" };
const session = { accessToken: secret, refreshToken: secret, businessUid: secret, uuid: secret };

const createRig = () => {
  const store = createMemoryNinebotAuthSessionStore();
  const provider: NinebotAuthProvider = {
    loginWithPassword: vi.fn(async () => session),
    requestSmsCode: vi.fn(),
    loginWithSmsCode: vi.fn(),
    whoami: vi.fn(async () => ({ privateProfile: secret })) as NinebotAuthProvider["whoami"],
    refresh: vi.fn(async () => ({
      ...session,
      accessToken: "refreshed-private-marker",
      refreshToken: "rotated-private-marker",
    })),
  };
  const client = {
    listVehicles: vi.fn(async () => ({
      code: 1,
      data: [{ wnumber: secret, vehicle_type: 14363, privateName: secret }],
      desc: secret,
      time_cost: null,
      extra: null,
    })),
    status: vi.fn(async () => ({
      code: 1,
      data: [{ serialNumber: secret }],
      desc: secret,
      time_cost: null,
      extra: null,
    })),
    battery: vi.fn(async () => ({
      code: 1,
      data: { privateBattery: secret },
      desc: secret,
      time_cost: null,
      extra: null,
    })),
    month: vi.fn(async () => ({
      code: 1,
      month: "202609",
      list: [{ travel_id: secret }],
      detail: [],
      desc: secret,
      duration: 1,
      ec: 1,
      first_time: 1,
      times: 1,
      total_mileages: 1,
    })),
    detail: vi.fn(async () => ({ code: 1, desc: secret, trail: secret })),
    clear: vi.fn(),
  } satisfies NinebotCandidateSessionClient;
  const contexts: NinebotCandidateSessionFields[] = [];
  const createAuth = vi.fn(() => new NinebotAuthSessionManager({ provider, store }));
  const run = (options: Partial<AuthAcceptanceOptions> = {}) =>
    runNinebotAuthAcceptance({
      directory: "/unused-injected-test-directory",
      credentials,
      service: "ebike",
      month: "202609",
      createAuth,
      loadDevice: async () => device,
      createClient: (value) => {
        contexts.push(value);
        return client;
      },
      ...options,
    });
  return { store, provider, client, contexts, createAuth, run };
};

describe("fresh SDK authentication acceptance", () => {
  it("checks persisted refresh tokens and uses them for every domain read without leaking values", async () => {
    const rig = createRig();
    const report = await rig.run();
    expect(report.outcome).toBe("passed");
    expect(report.checks.map((check) => check.stage)).toEqual([
      "login",
      "profile",
      "restore",
      "refresh",
      "restore-refreshed",
      "profile-refreshed",
      "vehicles",
      "status",
      "battery",
      "month",
      "detail",
      "logout",
    ]);
    expect(rig.provider.refresh).toHaveBeenCalledTimes(1);
    expect(rig.provider.whoami).toHaveBeenLastCalledWith(
      expect.objectContaining({ accessToken: "refreshed-private-marker" }),
    );
    expect(rig.createAuth).toHaveBeenCalledTimes(4);
    expect(rig.contexts).toHaveLength(5);
    expect(
      rig.contexts.every(
        (context) => context.access_token === "refreshed-private-marker" && context.uid === secret,
      ),
    ).toBe(true);
    expect(rig.client.listVehicles).toHaveBeenCalledWith({ service: "ebike", vehicleType: "65" });
    expect(rig.client.month).toHaveBeenCalledWith({
      service: "ebike",
      vehicleType: "14363",
      serialNumber: secret,
      month: "202609",
    });
    expect(rig.client.clear).toHaveBeenCalledTimes(5);
    expect(JSON.stringify(report)).not.toMatch(/private-marker/);
    await expect(rig.store.load()).resolves.toBeNull();
  });

  it("cleans up and suppresses arbitrary upstream errors when refresh fails", async () => {
    const rig = createRig();
    vi.mocked(rig.provider.refresh!).mockRejectedValue(new Error(secret));
    const report = await rig.run();
    expect(report.outcome).toBe("failed");
    expect(report.checks).toContainEqual({
      stage: "refresh",
      outcome: "failed",
      reason: "request-failed",
    });
    expect(report.checks.at(-1)).toEqual({ stage: "logout", outcome: "passed" });
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(rig.client.listVehicles).not.toHaveBeenCalled();
    await expect(rig.store.load()).resolves.toBeNull();
  });

  it("rejects refresh results that were never persisted", async () => {
    const rig = createRig();
    const save = rig.store.save;
    rig.store.save = vi.fn().mockImplementationOnce(save).mockResolvedValue(undefined);
    const report = await rig.run();
    expect(report.checks).toContainEqual({
      stage: "restore-refreshed",
      outcome: "failed",
      reason: "invalid-response",
    });
    expect(report.outcome).toBe("failed");
    expect(rig.client.listVehicles).not.toHaveBeenCalled();
    await expect(rig.store.load()).resolves.toBeNull();
  });

  it("does not report success when logout cannot delete stored credentials", async () => {
    const rig = createRig();
    rig.store.clear = vi.fn().mockRejectedValue(new Error(secret));
    const report = await rig.run();
    expect(report.outcome).toBe("failed");
    expect(report.checks.at(-1)).toEqual({
      stage: "logout",
      outcome: "failed",
      reason: "request-failed",
    });
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it("treats an empty vehicle sample as incomplete", async () => {
    const rig = createRig();
    rig.client.listVehicles.mockResolvedValue({
      code: 1,
      data: [],
      desc: secret,
      time_cost: null,
      extra: null,
    });
    const report = await rig.run();
    expect(report.outcome).toBe("incomplete");
    expect(report.checks.filter((check) => check.outcome === "skipped")).toHaveLength(4);
    expect(rig.client.status).not.toHaveBeenCalled();
    await expect(rig.store.load()).resolves.toBeNull();
  });

  it("treats an empty month as incomplete instead of passing the detail gate", async () => {
    const rig = createRig();
    rig.client.month.mockResolvedValue({
      code: 1,
      month: "202609",
      list: [],
      detail: [],
      desc: secret,
      duration: 0,
      ec: 0,
      first_time: 1,
      times: 0,
      total_mileages: 0,
    });
    const report = await rig.run();
    expect(report.outcome).toBe("incomplete");
    expect(report.checks).toContainEqual({
      stage: "detail",
      outcome: "skipped",
      reason: "no-trip",
    });
    expect(rig.client.detail).not.toHaveBeenCalled();
  });

  it("rejects error business codes even when the response has plausible vehicle data", async () => {
    const rig = createRig();
    rig.client.listVehicles.mockResolvedValue({
      code: 190003,
      data: [{ wnumber: secret, vehicle_type: 14363, privateName: secret }],
      desc: secret,
      time_cost: null,
      extra: null,
    });
    const report = await rig.run();
    expect(report.checks).toContainEqual({
      stage: "vehicles",
      outcome: "failed",
      reason: "invalid-response",
    });
    expect(rig.client.status).not.toHaveBeenCalled();
    expect(report.outcome).toBe("failed");
  });

  it("releases a domain client on HTTP failure and reports only a bounded status code", async () => {
    const rig = createRig();
    rig.client.status.mockRejectedValue(new NinebotHttpError(503));
    const report = await rig.run();
    expect(report.checks).toContainEqual({
      stage: "status",
      outcome: "failed",
      reason: "http",
      httpStatus: 503,
    });
    expect(rig.client.clear).toHaveBeenCalledTimes(2);
    expect(rig.client.battery).not.toHaveBeenCalled();
    await expect(rig.store.load()).resolves.toBeNull();
  });

  it("does not accept an empty profile as successful upstream authentication", async () => {
    const rig = createRig();
    vi.mocked(rig.provider.whoami).mockResolvedValue({});
    const report = await rig.run();
    expect(report.checks).toContainEqual({
      stage: "profile",
      outcome: "failed",
      reason: "invalid-response",
    });
    expect(rig.provider.refresh).not.toHaveBeenCalled();
    await expect(rig.store.load()).resolves.toBeNull();
  });

  it("cleans up when interrupted after login without starting profile or domain requests", async () => {
    const rig = createRig();
    const controller = new AbortController();
    vi.mocked(rig.provider.loginWithPassword).mockImplementation(async () => {
      controller.abort();
      return session;
    });
    const report = await rig.run({ signal: controller.signal });
    expect(report.checks).toContainEqual({
      stage: "login",
      outcome: "failed",
      reason: "cancelled",
    });
    expect(rig.provider.whoami).not.toHaveBeenCalled();
    await expect(rig.store.load()).resolves.toBeNull();
  });

  it("detects credentials resurrected by a legacy fallback after logout", async () => {
    const rig = createRig();
    const load = rig.store.load;
    rig.store.load = vi
      .fn()
      .mockImplementationOnce(load)
      .mockImplementationOnce(load)
      .mockResolvedValueOnce(session);
    const report = await rig.run();
    expect(report.checks.at(-1)).toEqual({
      stage: "logout",
      outcome: "failed",
      reason: "invalid-response",
    });
    expect(report.outcome).toBe("failed");
  });

  it("allows automatic refresh during profile before testing persisted restoration", async () => {
    const rig = createRig();
    vi.mocked(rig.provider.loginWithPassword).mockResolvedValue({ ...session, expiresAtMs: 1 });
    vi.mocked(rig.provider.refresh!).mockResolvedValue({
      ...session,
      accessToken: "refreshed-private-marker",
      expiresAtMs: Date.now() + 3_600_000,
    });
    const report = await rig.run();
    expect(report.outcome).toBe("passed");
    expect(rig.provider.refresh).toHaveBeenCalledTimes(2);
  });

  it.each([90002, secret])(
    "reports only numeric Passport codes and never upstream descriptions: %s",
    async (code) => {
      const rig = createRig();
      vi.mocked(rig.provider.loginWithPassword).mockRejectedValue(
        new PassportLoginBusinessError(code, secret),
      );
      const report = await rig.run();
      expect(report.checks[0]).toEqual({
        stage: "login",
        outcome: "failed",
        reason: "passport",
        ...(typeof code === "number" ? { businessCode: code } : {}),
      });
      expect(JSON.stringify(report)).not.toContain(secret);
      await expect(rig.store.load()).resolves.toBeNull();
    },
  );
});

describe("acceptance input", () => {
  it("computes the previous calendar month correctly at month end", () => {
    expect(parseAuthAcceptanceArguments([], new Date(2026, 2, 31)).month).toBe("202602");
    expect(parseAuthAcceptanceArguments([], new Date(2026, 0, 31)).month).toBe("202512");
  });

  it.each([
    ["--password=" + secret],
    ["--month=202613"],
    ["--vehicle-index=-1"],
    ["--service=car"],
    ["--service=motor", "--service=ebike"],
    ["--config=/existing-account"],
  ])(
    "rejects invalid, secret or account-directory arguments without echoing them: %j",
    (...args) => {
      expect(() => parseAuthAcceptanceArguments(args)).toThrow();
      try {
        parseAuthAcceptanceArguments(args);
      } catch (error) {
        expect(String(error)).not.toContain(secret);
      }
    },
  );

  it("accepts only credentials from the provided input object", () => {
    expect(parseAuthAcceptanceCredentials({ user: " test ", password: " pass " })).toEqual({
      user: "test",
      password: " pass ",
      areaCode: "86",
    });
    expect(() => parseAuthAcceptanceCredentials({ user: secret, password: "" })).toThrow(
      "Invalid credentials input",
    );
    expect(
      parseAuthAcceptanceArguments([
        "--service=motor",
        "--vehicle-index=1",
        "--credentials-stdin",
        "--month=202608",
      ]),
    ).toEqual({ service: "motor", vehicleIndex: 1, credentialsStdin: true, month: "202608" });
  });
});
