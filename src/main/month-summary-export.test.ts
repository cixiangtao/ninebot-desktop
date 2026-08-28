import { describe, expect, it } from "vitest";
import type { MonthSummaryExportInput } from "../shared/contracts.js";
import { createMonthSummaryExportDocument } from "./month-summary-export.js";

const input = {
  vehicleName: "F90",
  format: "json",
  month: {
    summary: {
      month: "202607",
      historyStartTime: 1_763_793_834,
      rideCount: 31,
      mileageKm: 649.4,
      durationSeconds: 72_000,
      energyWh: 8_420,
      visibleRideCount: 2,
      aggregateAvailable: true,
      ridesTruncated: true,
      activeDayCount: 28,
      longestDayMileageKm: 39.6,
    },
    days: [
      { day: 1, mileageKm: 12.4 },
      { day: 2, mileageKm: 0 },
    ],
    rides: [
      {
        id: "ride-1",
        startTime: 1_751_324_400,
        endTime: 1_751_325_000,
        mileageKm: 8.3,
        durationSeconds: 600,
        declaredMaxSpeed: 25,
        energyWh: 231,
        batteryUsedPercent: 4,
        dayMileageKm: 12.4,
      },
      {
        id: "ride-2",
        startTime: 1_751_328_000,
        endTime: 1_751_328_900,
        mileageKm: 11.5,
        durationSeconds: 900,
        declaredMaxSpeed: 25,
        energyWh: 320,
        batteryUsedPercent: 5,
        dayMileageKm: 19.8,
      },
    ],
  },
  speedVerifications: [{ id: "ride-1", declaredMaxSpeed: 25, sampledMaxSpeed: 68 }],
} satisfies MonthSummaryExportInput;

describe("month summary export", () => {
  it("preserves speed provenance without presenting an unverified 25 as a maximum", () => {
    const document = createMonthSummaryExportDocument(input);
    const payload = JSON.parse(document.content) as {
      schemaVersion: number;
      coverage: Record<string, number | boolean>;
      rides: Array<Record<string, unknown>>;
    };

    expect(document.fileName).toBe("骑迹-F90-202607月度清单.json");
    expect(payload.schemaVersion).toBe(1);
    expect(payload.coverage).toMatchObject({
      rideCount: 31,
      visibleRideCount: 2,
      ridesTruncated: true,
      verifiedSpeedCount: 1,
      correctedSpeedCount: 1,
      unverifiedCappedSpeedCount: 1,
    });
    expect(payload.rides[0]).toMatchObject({
      declaredMaxSpeedKmh: 25,
      sampledMaxSpeedKmh: 68,
      displayedMaxSpeedKmh: 68,
      maximumSpeedSource: "track",
    });
    expect(payload.rides[1]).toMatchObject({
      declaredMaxSpeedKmh: 25,
      sampledMaxSpeedKmh: null,
      displayedMaxSpeedKmh: null,
      maximumSpeedSource: "unverified-capped",
    });
    expect(document.content).not.toMatch(/longitude|latitude|trail|vehicleId|travel[_I]d|"id"/i);
  });

  it("creates an Excel-friendly CSV with month, day, and ride rows", () => {
    const document = createMonthSummaryExportDocument({ ...input, format: "csv" });
    const lines = document.content.trim().split("\r\n");
    const header = lines[0]?.slice(1).split(",") ?? [];

    expect(document.fileName).toBe("骑迹-F90-202607月度清单.csv");
    expect(header).toContain("sampled_max_speed_kmh");
    expect(header).toContain("maximum_speed_source");
    expect(lines.some((line) => line.startsWith("day,F90,202607,1,"))).toBe(true);
    expect(lines.some((line) => line.includes(",68,68,track,"))).toBe(true);
    expect(lines.some((line) => line.includes(",25,,,unverified-capped,"))).toBe(true);
  });
});
