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
    const candidateClient: CandidateVehicleClient = {
      list: async ({ service, fields }) => {
        observedService = service;
        observedVehicleType = fields.vehicle_type;
        expect(fields.access_token).toBe("token");
        expect(fields.serviceTime).toBeGreaterThan(1_000_000_000_000);
        expect(fields.nonce).toMatch(/^[0-9a-f]{32}$/);
        return { data: [{ wnumber: "SN1234567890", vehicle_name: "candidate vehicle" }] };
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
});
