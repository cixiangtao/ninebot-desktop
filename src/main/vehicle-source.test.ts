import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCandidateVehicleReader, type CandidateVehicleClient } from "./vehicle-source.js";

const temporaryDirectories: string[] = [];

const createSessionDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "ninebot-vehicle-source-"));
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

const addCachedVehicleType = async (directory: string) => {
  await writeFile(
    join(directory, "vehicles.json"),
    JSON.stringify({
      vehicles: [{ wnumber: "SN1234567890", business_line: "ebike", vehicle_type: 14363 }],
    }),
  );
};

const addCachedVehicleTypes = async (directory: string) => {
  await writeFile(
    join(directory, "vehicles.json"),
    JSON.stringify({
      vehicles: [
        { wnumber: "SN-E-1", business_line: "ebike", vehicle_type: 14363 },
        { wnumber: "SN-E-2", business_line: "ebike", vehicle_type: 14364 },
      ],
    }),
  );
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("candidate vehicle source", () => {
  it("uses candidate data for each available service and keeps session fields in memory", async () => {
    const configDirectory = await createSessionDirectory();
    let observedService: string | undefined;
    let observedVehicleType: string | undefined;
    let clearCount = 0;
    const candidateClient: CandidateVehicleClient = {
      listVehicles: async ({ service, vehicleType }) => {
        observedService = service;
        observedVehicleType = String(vehicleType);
        return { data: [{ wnumber: "SN1234567890", vehicle_name: "candidate vehicle" }] };
      },
      clear: () => {
        clearCount += 1;
      },
    };
    const reader = createCandidateVehicleReader({
      configDirectory,
      legacy: {
        vehicles: async () => [{ wnumber: "SN1234567890", businessType: 2, vehicle_type: 14363 }],
      },
      candidateClientFactory: () => candidateClient,
    });

    await expect(reader.vehicles()).resolves.toEqual([
      { wnumber: "SN1234567890", vehicle_name: "candidate vehicle" },
    ]);
    expect(observedService).toBe("ebike");
    expect(observedVehicleType).toBe("14363");
    expect(clearCount).toBe(1);
  });

  it("falls back to the legacy vehicle list when candidate data is unavailable", async () => {
    const configDirectory = await createSessionDirectory();
    const legacyRows = [{ wnumber: "SN1234567890", businessType: 2, vehicle_type: 14363 }];
    const reader = createCandidateVehicleReader({
      configDirectory,
      legacy: { vehicles: async () => legacyRows },
      candidateClientFactory: () => {
        throw new Error("candidate unavailable");
      },
    });

    await expect(reader.vehicles()).resolves.toEqual(legacyRows);
  });

  it("does not invoke ninecli when the private vehicle cache has complete metadata", async () => {
    const configDirectory = await createSessionDirectory();
    await addCachedVehicleType(configDirectory);
    const candidateClient: CandidateVehicleClient = {
      listVehicles: async ({ vehicleType }) => {
        expect(vehicleType).toBe("14363");
        return { data: [{ wnumber: "SN1234567890", vehicle_name: "cached metadata vehicle" }] };
      },
    };
    const reader = createCandidateVehicleReader({
      configDirectory,
      legacy: {
        vehicles: async () => {
          throw new Error("legacy vehicles should not be called");
        },
      },
      candidateClientFactory: () => candidateClient,
    });

    await expect(reader.vehicles()).resolves.toEqual([
      { wnumber: "SN1234567890", vehicle_name: "cached metadata vehicle" },
    ]);
  });

  it("requests each model code once and de-duplicates overlapping service responses", async () => {
    const configDirectory = await createSessionDirectory();
    await addCachedVehicleTypes(configDirectory);
    const requestedTypes: Array<string | number> = [];
    const reader = createCandidateVehicleReader({
      configDirectory,
      legacy: {
        vehicles: async () => {
          throw new Error("legacy vehicles should not be called");
        },
      },
      candidateClientFactory: () => ({
        listVehicles: async ({ vehicleType }) => {
          requestedTypes.push(vehicleType);
          return {
            data: [
              { wnumber: "SN-E-1", vehicle_name: "first" },
              { wnumber: "SN-E-2", vehicle_name: "second" },
            ],
          };
        },
      }),
    });

    await expect(reader.vehicles()).resolves.toEqual([
      { wnumber: "SN-E-1", vehicle_name: "first" },
      { wnumber: "SN-E-2", vehicle_name: "second" },
    ]);
    expect(requestedTypes).toEqual(["14363", "14364"]);
  });
});
