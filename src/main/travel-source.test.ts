import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCandidateTravelReader, type CandidateTravelClient } from "./travel-source.js";

const temporaryDirectories: string[] = [];

const createSessionDirectory = async (vehicleType?: string) => {
  const directory = await mkdtemp(join(tmpdir(), "ninebot-travel-source-"));
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
      JSON.stringify({
        vehicles: [
          {
            wnumber: "SN1234567890",
            business_line: "ebike",
            ...(vehicleType === undefined ? {} : { vehicle_type: vehicleType }),
          },
        ],
      }),
    ),
  ]);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("candidate travel source", () => {
  it("uses the candidate month and detail responses with private session fields", async () => {
    const configDirectory = await createSessionDirectory("14363");
    const calls: Array<{ kind: string; month?: string; travelId?: string; businessType: string }> =
      [];
    let clearCount = 0;
    const candidateClient: CandidateTravelClient = {
      month: async ({ month, service, vehicleType }) => {
        calls.push({ kind: "month", month, businessType: service === "motor" ? "1" : "2" });
        expect(vehicleType).toBe("14363");
        return { data: { month, list: [] } };
      },
      detail: async ({ travelId, service, vehicleType }) => {
        calls.push({ kind: "detail", travelId, businessType: service === "motor" ? "1" : "2" });
        expect(vehicleType).toBe("14363");
        return { data: { trail: "" } };
      },
      clear: () => {
        clearCount += 1;
      },
    };
    const legacy = {
      rides: async () => {
        throw new Error("legacy rides should not be called");
      },
      rideDetail: async () => {
        throw new Error("legacy detail should not be called");
      },
    };
    const reader = createCandidateTravelReader({
      legacy,
      configDirectory,
      candidateClientFactory: () => candidateClient,
    });

    await expect(reader.rides("SN1234567890", "202608")).resolves.toMatchObject({
      data: { month: "202608" },
    });
    await expect(reader.rideDetail("SN1234567890", "travel-1")).resolves.toEqual({
      data: { trail: "" },
    });
    expect(calls).toEqual([
      { kind: "month", month: "202608", businessType: "2" },
      { kind: "detail", travelId: "travel-1", businessType: "2" },
    ]);
    expect(clearCount).toBe(2);
  });

  it("falls back to ninecli when the cached vehicle model code is unavailable", async () => {
    const configDirectory = await createSessionDirectory();
    const legacy = {
      rides: async (_serialNumber: string, month: string) => ({ source: "legacy", month }),
      rideDetail: async (_serialNumber: string, travelId: string) => ({
        source: "legacy",
        travelId,
      }),
    };
    const reader = createCandidateTravelReader({
      legacy,
      configDirectory,
      fallbackToLegacy: true,
      candidateClientFactory: () => {
        throw new Error("candidate client should not be created");
      },
    });

    await expect(reader.rides("SN1234567890", "202608")).resolves.toEqual({
      source: "legacy",
      month: "202608",
    });
    await expect(reader.rideDetail("SN1234567890", "travel-1")).resolves.toEqual({
      source: "legacy",
      travelId: "travel-1",
    });
  });

  it("enriches the private cache from ninecli vehicle output without persisting it", async () => {
    const configDirectory = await createSessionDirectory();
    let observedVehicleType: string | undefined;
    const reader = createCandidateTravelReader({
      legacy: {
        rides: async () => {
          throw new Error("legacy rides should not be called");
        },
        rideDetail: async () => {
          throw new Error("legacy detail should not be called");
        },
        vehicles: async () => [{ wnumber: "SN1234567890", businessType: 2, vehicle_type: 14363 }],
      },
      configDirectory,
      fallbackToLegacy: true,
      candidateClientFactory: () => ({
        month: async ({ vehicleType, month }) => {
          observedVehicleType = vehicleType;
          return { data: { month, list: [] } };
        },
        detail: async () => ({ data: { trail: "" } }),
      }),
    });

    await expect(reader.rides("SN1234567890", "202608")).resolves.toMatchObject({
      data: { month: "202608" },
    });
    expect(observedVehicleType).toBe("14363");
  });

  it("cancels an in-flight month request without falling back", async () => {
    const configDirectory = await createSessionDirectory("14363");
    let signalReceived: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalReceived = resolve;
    });
    const reader = createCandidateTravelReader({
      legacy: {
        rides: async () => {
          throw new Error("legacy rides should not be called after cancellation");
        },
        rideDetail: async () => ({ source: "legacy" }),
      },
      configDirectory,
      candidateClientFactory: () => ({
        month: ({ signal }) => {
          signalReceived?.();
          return new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
        detail: async () => ({ data: { trail: "" } }),
      }),
    });

    const pending = reader.rides("SN1234567890", "202608");
    await started;
    reader.clear?.();

    await expect(pending).rejects.toThrow("candidate request was cancelled");
  });
});
