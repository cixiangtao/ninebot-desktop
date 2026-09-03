import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCandidateTelemetryReader,
  type CandidateTelemetryClient,
} from "./telemetry-source.js";

const temporaryDirectories: string[] = [];

const createSessionDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "ninebot-telemetry-source-"));
  temporaryDirectories.push(directory);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(
      join(directory, "config.json"),
      JSON.stringify({
        device_id: "device-id",
        region: "bj",
        os_version: "13",
        os_model: "Xiaomi",
      }),
    ),
    writeFile(
      join(directory, "tokens.json"),
      JSON.stringify({ access_token: "token", business_uid: "12345678" }),
    ),
    writeFile(
      join(directory, "vehicles.json"),
      JSON.stringify({ vehicles: [{ wnumber: "SN1234567890", business_line: "ebike" }] }),
    ),
  ]);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("candidate telemetry source", () => {
  it("uses the candidate response when the session and request succeed", async () => {
    const configDirectory = await createSessionDirectory();
    let clearCount = 0;
    const candidateClient: CandidateTelemetryClient = {
      status: async () => ({ data: [{ pwr: 1 }] }),
      battery: async () => ({ data: { electricity: 80 } }),
      clear: () => {
        clearCount += 1;
      },
    };
    const legacy = {
      vehicleStatus: async () => {
        throw new Error("legacy status should not be called");
      },
      battery: async () => {
        throw new Error("legacy battery should not be called");
      },
    };
    const reader = createCandidateTelemetryReader({
      legacy,
      configDirectory,
      candidateClientFactory: () => candidateClient,
    });

    await expect(reader.vehicleStatus("SN1234567890")).resolves.toEqual({ data: [{ pwr: 1 }] });
    await expect(reader.battery("SN1234567890")).resolves.toEqual({ data: { electricity: 80 } });
    expect(clearCount).toBe(2);
  });

  it("accepts numeric businessType values from the vehicle cache", async () => {
    const configDirectory = await createSessionDirectory();
    await writeFile(
      join(configDirectory, "vehicles.json"),
      JSON.stringify({ vehicles: [{ wnumber: "SN1234567890", businessType: 2 }] }),
    );
    const candidateClient: CandidateTelemetryClient = {
      status: async () => ({ data: [{ pwr: 1 }] }),
      battery: async () => ({ data: { electricity: 80 } }),
    };
    const reader = createCandidateTelemetryReader({
      legacy: {
        vehicleStatus: async () => {
          throw new Error("legacy status should not be called");
        },
        battery: async () => {
          throw new Error("legacy battery should not be called");
        },
      },
      configDirectory,
      candidateClientFactory: () => candidateClient,
    });

    await expect(reader.vehicleStatus("SN1234567890")).resolves.toEqual({ data: [{ pwr: 1 }] });
  });

  it("cancels an in-flight candidate request without falling back", async () => {
    const configDirectory = await createSessionDirectory();
    let signalReceived: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalReceived = resolve;
    });
    const reader = createCandidateTelemetryReader({
      legacy: {
        vehicleStatus: async () => {
          throw new Error("legacy status should not be called after cancellation");
        },
        battery: async () => ({ pwr: 1 }),
      },
      configDirectory,
      candidateClientFactory: () => ({
        status: ({ signal }) => {
          signalReceived?.();
          return new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
        battery: async () => ({ data: { electricity: 80 } }),
      }),
    });

    const pending = reader.vehicleStatus("SN1234567890");
    await started;
    reader.clear?.();

    await expect(pending).rejects.toThrow("candidate request was cancelled");
  });

  it("does not start or fall back after clearing during session loading", async () => {
    const configDirectory = await createSessionDirectory();
    let candidateCalls = 0;
    let legacyCalls = 0;
    const reader = createCandidateTelemetryReader({
      legacy: {
        vehicleStatus: async () => {
          legacyCalls += 1;
          return { pwr: 1 };
        },
        battery: async () => ({ pwr: 1 }),
      },
      configDirectory,
      candidateClientFactory: () => {
        candidateCalls += 1;
        return {
          status: async () => ({ data: [{ pwr: 1 }] }),
          battery: async () => ({ data: { electricity: 80 } }),
        };
      },
    });

    const pending = reader.vehicleStatus("SN1234567890");
    reader.clear?.();

    await expect(pending).rejects.toThrow("candidate request was cancelled");
    expect(candidateCalls).toBe(0);
    expect(legacyCalls).toBe(0);
  });

  it("falls back independently when a candidate request fails", async () => {
    const configDirectory = await createSessionDirectory();
    const reader = createCandidateTelemetryReader({
      legacy: {
        vehicleStatus: async () => ({ pwr: 1 }),
        battery: async () => ({ electricity: 72 }),
      },
      configDirectory,
      candidateClientFactory: () => ({
        status: async () => {
          throw new Error("candidate unavailable");
        },
        battery: async () => ({ data: { electricity: 80 } }),
      }),
    });

    await expect(reader.vehicleStatus("SN1234567890")).resolves.toEqual({ pwr: 1 });
    await expect(reader.battery("SN1234567890")).resolves.toEqual({ data: { electricity: 80 } });
  });
});
