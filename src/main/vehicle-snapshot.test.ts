import { describe, expect, it } from "vitest";
import { NineCliError } from "./ninecli.js";
import { loadVehicleSnapshot } from "./vehicle-snapshot.js";

const createClient = (options: { status?: unknown; battery?: unknown }) => ({
  vehicleStatus: async () => {
    if (options.status instanceof Error) throw options.status;
    return options.status;
  },
  battery: async () => {
    if (options.battery instanceof Error) throw options.battery;
    return options.battery;
  },
});

describe("vehicle telemetry partitioning", () => {
  it("keeps battery diagnostics when status is temporarily unavailable", async () => {
    const snapshot = await loadVehicleSnapshot(
      createClient({
        status: new NineCliError("status unavailable", "upstream"),
        battery: {
          electricity: 72,
          battery_type: "1",
          battery_list: [{ electricity: 72, bms_volt: 53.1 }],
        },
      }),
      "PRIVATE-SERIAL",
    );

    expect(snapshot).toMatchObject({
      availability: { status: false, battery: true },
      batteryPercent: 72,
      batteryPercentSource: "battery",
      statusBatteryPercent: null,
      diagnosticBatteryPercent: 72,
      batteryChemistry: "lithium",
      locked: null,
      poweredOn: null,
    });
  });

  it("keeps vehicle state when battery diagnostics are temporarily unavailable", async () => {
    const snapshot = await loadVehicleSnapshot(
      createClient({
        status: {
          pwr: 1,
          charging: 0,
          dump_energy: "64",
          precise_estimate_mileage: 88.6,
          loc: { lock: 1, acc: 0 },
        },
        battery: new NineCliError("battery unavailable", "upstream"),
      }),
      "PRIVATE-SERIAL",
    );

    expect(snapshot).toMatchObject({
      availability: { status: true, battery: false },
      batteryPercent: 64,
      batteryPercentSource: "status",
      statusBatteryPercent: 64,
      diagnosticBatteryPercent: null,
      charging: false,
      locked: true,
      poweredOn: true,
      ignitionOn: false,
      preciseEstimatedRangeKm: 88.6,
    });
  });

  it("fails when both domains fail or a security boundary fails", async () => {
    await expect(
      loadVehicleSnapshot(
        createClient({
          status: new NineCliError("status unavailable", "upstream"),
          battery: new NineCliError("battery unavailable", "upstream"),
        }),
        "PRIVATE-SERIAL",
      ),
    ).rejects.toThrow("status unavailable");

    await expect(
      loadVehicleSnapshot(
        createClient({
          status: new NineCliError("login required", "auth"),
          battery: { electricity: 72 },
        }),
        "PRIVATE-SERIAL",
      ),
    ).rejects.toMatchObject({ kind: "auth" });
  });
});
