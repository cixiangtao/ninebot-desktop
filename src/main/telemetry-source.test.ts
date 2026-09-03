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
    const candidateClient: CandidateTelemetryClient = {
      status: async () => ({ data: [{ pwr: 1 }] }),
      battery: async () => ({ data: { electricity: 80 } }),
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
