import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCandidateVehicleReader } from "./vehicle-source.js";
import { createCandidateTelemetryReader } from "./telemetry-source.js";
import { createCandidateTravelReader } from "./travel-source.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});
const row = (service: "ebike" | "motor", sn = "synthetic-shared") => ({
  wnumber: sn,
  business_line: service,
  vehicle_type: service === "ebike" ? "67" : "68",
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((release) => {
    resolve = release;
  });
  return { promise, resolve };
};
const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), "sdk-metadata-isolation-"));
  directories.push(directory);
  const config = (region: string) =>
    writeFile(
      join(directory, "config.json"),
      JSON.stringify({
        device_id: "synthetic",
        region,
        os_version: "13",
        os_model: "synthetic",
      }),
    );
  await config("bj");
  const state = { uid: "synthetic-a", token: "synthetic-token-a", empty: false };
  const sessionProvider = async () => ({ accessToken: state.token, businessUid: state.uid });
  const calls = vi.fn();
  const createVehicles = () =>
    createCandidateVehicleReader({
      configDirectory: directory,
      sessionProvider,
      candidateClientFactory: (session) => ({
        listVehicles: async ({ service, vehicleType }) => {
          calls("vehicles", session.uid, service, vehicleType);
          const expected = session.uid === "synthetic-a" ? "ebike" : "motor";
          return { data: !state.empty && service === expected ? [row(expected)] : [] };
        },
      }),
    });
  const vehicles = createVehicles();
  const telemetry = createCandidateTelemetryReader({
    configDirectory: directory,
    sessionProvider,
    candidateClientFactory: (session) => ({
      status: async ({ service }) => {
        calls("status", session.uid, service);
        return {};
      },
      battery: async ({ service }) => {
        calls("battery", session.uid, service);
        return {};
      },
    }),
  });
  const travel = createCandidateTravelReader({
    configDirectory: directory,
    sessionProvider,
    candidateClientFactory: (session) => ({
      month: async ({ service, vehicleType }) => {
        calls("month", session.uid, service, vehicleType);
        return {};
      },
      detail: async ({ service, vehicleType }) => {
        calls("detail", session.uid, service, vehicleType);
        return {};
      },
    }),
  });
  const reads = {
    status: () => telemetry.vehicleStatus("synthetic-shared"),
    battery: () => telemetry.battery("synthetic-shared"),
    month: () => travel.rides("synthetic-shared", "202610"),
    detail: () => travel.rideDetail("synthetic-shared", "synthetic-ride"),
  };
  return {
    directory,
    state,
    calls,
    vehicles,
    createVehicles,
    telemetry,
    travel,
    reads,
    config,
    sessionProvider,
  };
};

describe("SDK vehicle discovery and private metadata isolation (offline)", () => {
  it("accepts a connected account with no vehicles, including a subsequent cold restore", async () => {
    const f = await setup();
    f.state.empty = true;
    await expect(f.vehicles.vehicles()).resolves.toEqual([]);
    await expect(f.createVehicles().vehicles()).resolves.toEqual([]);
    expect(f.calls.mock.calls).toEqual([
      ["vehicles", "synthetic-a", "ebike", "65"],
      ["vehicles", "synthetic-a", "motor", "64"],
      ["vehicles", "synthetic-a", "ebike", "65"],
      ["vehicles", "synthetic-a", "motor", "64"],
    ]);
  });
  it.each(["status", "battery", "month", "detail"] as const)(
    "blocks %s metadata from the previous account before rediscovery",
    async (method) => {
      const f = await setup();
      await f.vehicles.vehicles();
      f.state.uid = "synthetic-b";
      f.state.token = "synthetic-token-b";
      f.calls.mockClear();
      await expect(f.reads[method]()).rejects.toThrow(/vehicle|cache/i);
      expect(f.calls).not.toHaveBeenCalled();
    },
  );
  it("discovers a new account's service family, then serves all readers from its own cache", async () => {
    const f = await setup();
    await f.vehicles.vehicles();
    f.state.uid = "synthetic-b";
    f.calls.mockClear();
    await expect(f.vehicles.vehicles()).resolves.toEqual([row("motor")]);
    await f.reads.status();
    await f.reads.battery();
    await f.reads.month();
    await f.reads.detail();
    expect(f.calls.mock.calls).toEqual([
      ["vehicles", "synthetic-b", "ebike", "65"],
      ["vehicles", "synthetic-b", "motor", "64"],
      ["status", "synthetic-b", "motor"],
      ["battery", "synthetic-b", "motor"],
      ["month", "synthetic-b", "motor", "68"],
      ["detail", "synthetic-b", "motor", "68"],
    ]);
    f.state.uid = "synthetic-a";
    await f.reads.month();
    expect(f.calls).toHaveBeenLastCalledWith("month", "synthetic-a", "ebike", "67");
  });
  it("does not reuse a previous region's metadata", async () => {
    const f = await setup();
    await f.vehicles.vehicles();
    await f.config("eu");
    f.calls.mockClear();
    await expect(f.reads.status()).rejects.toThrow(/vehicle|cache/i);
    await expect(f.reads.month()).rejects.toThrow(/vehicle|cache/i);
    expect(f.calls).not.toHaveBeenCalled();
  });
  it.each(["vehicles.json", "vehicle-cache.json"])(
    "ignores ownerless %s without changing it",
    async (file) => {
      const f = await setup();
      const previous = JSON.stringify({ vehicles: [row("motor")] });
      await writeFile(join(f.directory, file), previous);
      await expect(f.reads.status()).rejects.toThrow(/vehicle|cache/i);
      await expect(f.reads.detail()).rejects.toThrow(/vehicle|cache/i);
      await expect(f.vehicles.vehicles()).resolves.toEqual([row("ebike")]);
      expect(f.calls.mock.calls.slice(0, 2)).toEqual([
        ["vehicles", "synthetic-a", "ebike", "65"],
        ["vehicles", "synthetic-a", "motor", "64"],
      ]);
      expect(await readFile(join(f.directory, file), "utf8")).toBe(previous);
    },
  );
  it("persists only routing metadata while retaining display fields in the result", async () => {
    const f = await setup();
    const value = {
      ...row("ebike"),
      vehicle_name: "Synthetic display",
      extra: "synthetic-private-marker",
    };
    const reader = createCandidateVehicleReader({
      configDirectory: f.directory,
      sessionProvider: f.sessionProvider,
      candidateClientFactory: () => ({
        listVehicles: async ({ service }) => ({ data: service === "ebike" ? [value] : [] }),
      }),
    });
    expect(await reader.vehicles()).toEqual([value]);
    const files = (await readdir(f.directory)).filter((file) => file !== "config.json");
    expect(files).toHaveLength(1);
    const content = await readFile(join(f.directory, files[0]!), "utf8");
    expect(JSON.parse(content)).toEqual({ vehicles: [row("ebike")] });
    expect(content).not.toMatch(/synthetic-private-marker|Synthetic display|synthetic-token/);
  });
  it.each([null, {}, [null], [{ wnumber: "synthetic-bad" }]])(
    "does not publish malformed discovery as an empty account %#",
    async (bad) => {
      const f = await setup();
      const reader = createCandidateVehicleReader({
        configDirectory: f.directory,
        sessionProvider: f.sessionProvider,
        candidateClientFactory: () => ({ listVehicles: async () => ({ data: bad }) }),
      });
      await expect(reader.vehicles()).rejects.toThrow(/vehicle/i);
      expect(await readdir(f.directory)).toEqual(["config.json"]);
    },
  );
  it("keeps the previous complete cache when the second service fails", async () => {
    const f = await setup();
    await f.vehicles.vehicles();
    const reader = createCandidateVehicleReader({
      configDirectory: f.directory,
      sessionProvider: f.sessionProvider,
      candidateClientFactory: () => ({
        listVehicles: async ({ service }) => {
          if (service === "motor") throw new Error("synthetic upstream failure");
          return { data: [row("ebike", "synthetic-new")] };
        },
      }),
    });
    await expect(reader.vehicles()).rejects.toThrow("synthetic upstream failure");
    await f.reads.month();
    expect(f.calls).toHaveBeenLastCalledWith("month", "synthetic-a", "ebike", "67");
  });
  it("keeps same-account metadata across token rotation and a fresh reader", async () => {
    const f = await setup();
    await f.vehicles.vehicles();
    f.state.token = "synthetic-rotated-token";
    const status = vi.fn(async () => ({}));
    const restored = createCandidateTelemetryReader({
      configDirectory: f.directory,
      sessionProvider: f.sessionProvider,
      candidateClientFactory: () => ({ status, battery: async () => ({}) }),
    });
    await restored.vehicleStatus("synthetic-shared");
    expect(status).toHaveBeenCalledWith(expect.objectContaining({ service: "ebike" }));
    const contents = await Promise.all(
      (await readdir(f.directory)).map((file) => readFile(join(f.directory, file), "utf8")),
    );
    for (const content of contents)
      expect(content).not.toMatch(/synthetic-token|synthetic-rotated-token/);
  });
  it("rediscovers both families even when a complete cache exists", async () => {
    const f = await setup();
    await f.vehicles.vehicles();
    const request = vi.fn(async ({ service }: { service: string }) => ({
      data: [row(service as "ebike" | "motor", `synthetic-${service}`)],
    }));
    const reader = createCandidateVehicleReader({
      configDirectory: f.directory,
      sessionProvider: f.sessionProvider,
      candidateClientFactory: () => ({ listVehicles: request }),
    });
    await expect(reader.vehicles()).resolves.toEqual([
      row("ebike", "synthetic-ebike"),
      row("motor", "synthetic-motor"),
    ]);
    expect(request.mock.calls.map(([options]) => options.service)).toEqual(["ebike", "motor"]);
  });
  it("rejects an old account's late final discovery after clear and preserves the new cache", async () => {
    const f = await setup();
    const started = deferred<void>();
    const delayed = deferred<{ data: unknown }>();
    const reader = createCandidateVehicleReader({
      configDirectory: f.directory,
      sessionProvider: f.sessionProvider,
      candidateClientFactory: () => ({
        listVehicles: async ({ service }) => {
          if (service === "ebike") return { data: [] };
          started.resolve();
          return delayed.promise;
        },
      }),
    });
    const pending = reader.vehicles();
    const rejection = expect(pending).rejects.toThrow(/cancel/i);
    await started.promise;
    reader.clear?.();
    f.state.uid = "synthetic-b";
    await f.vehicles.vehicles();
    delayed.resolve({ data: [row("ebike")] });
    await rejection;
    await f.reads.status();
    expect(f.calls).toHaveBeenLastCalledWith("status", "synthetic-b", "motor");
    f.state.uid = "synthetic-a";
    await expect(f.reads.status()).rejects.toThrow(/vehicle|cache/i);
  });
  it.each(["status", "battery", "month", "detail"] as const)(
    "rejects late %s data after clear even if transport ignores cancellation",
    async (method) => {
      const f = await setup();
      await f.vehicles.vehicles();
      const started = deferred<void>();
      const delayed = deferred<unknown>();
      const request = async () => {
        started.resolve();
        return delayed.promise;
      };
      const telemetry = createCandidateTelemetryReader({
        configDirectory: f.directory,
        sessionProvider: f.sessionProvider,
        candidateClientFactory: () => ({ status: request, battery: request }),
      });
      const travel = createCandidateTravelReader({
        configDirectory: f.directory,
        sessionProvider: f.sessionProvider,
        candidateClientFactory: () => ({ month: request, detail: request }),
      });
      const reads = {
        status: () => telemetry.vehicleStatus("synthetic-shared"),
        battery: () => telemetry.battery("synthetic-shared"),
        month: () => travel.rides("synthetic-shared", "202610"),
        detail: () => travel.rideDetail("synthetic-shared", "synthetic-ride"),
      };
      const pending = reads[method]();
      const rejection = expect(pending).rejects.toThrow(/cancel/i);
      await started.promise;
      telemetry.clear?.();
      travel.clear?.();
      delayed.resolve({ synthetic: "old-account" });
      await rejection;
    },
  );
});
