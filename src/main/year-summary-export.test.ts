import { describe, expect, it } from "vitest";
import type { YearSummaryExportInput } from "../shared/contracts.js";
import { createYearSummaryExportDocument } from "./year-summary-export.js";

const input = {
  vehicleName: "F90",
  year: 2026,
  historyStartTime: 1_763_793_834,
  format: "json",
  months: [
    {
      summary: {
        month: "202608",
        historyStartTime: 1_763_793_834,
        rideCount: 31,
        mileageKm: 649.4,
        durationSeconds: 72_000,
        energyWh: 8_420,
        visibleRideCount: 20,
        aggregateAvailable: true,
        ridesTruncated: true,
        activeDayCount: 28,
        longestDayMileageKm: 39.6,
      },
      days: [
        { day: 1, mileageKm: 12.4 },
        { day: 2, mileageKm: 0 },
      ],
    },
  ],
} satisfies YearSummaryExportInput;

describe("year summary export", () => {
  it("creates a versioned JSON summary without sensitive or upstream identifiers", () => {
    const document = createYearSummaryExportDocument(input);
    const payload = JSON.parse(document.content) as Record<string, unknown>;

    expect(document.fileName).toBe("韭号出行-F90-2026年度摘要.json");
    expect(payload).toMatchObject({
      schemaVersion: 2,
      exportedBy: "韭号出行",
      vehicleName: "F90",
      year: 2026,
      coverage: {
        monthCount: 1,
        rideCount: 31,
        mileageKm: 649.4,
        activeDayCount: 28,
        longestDayMileageKm: 39.6,
        visibleRideCount: 20,
        truncatedMonthCount: 1,
        aggregateAvailable: true,
        ridesTruncated: true,
      },
    });
    const coverage = payload.coverage as Record<string, number | null>;
    expect(coverage.averageRideKm).toBeCloseTo(649.4 / 31, 8);
    expect(coverage.averageEnergyWhPerKm).toBeCloseTo(8_420 / 649.4, 8);
    const months = payload.months as Array<Record<string, number | null>>;
    expect(months[0]?.averageRideKm).toBeCloseTo(649.4 / 31, 8);
    expect(months[0]?.averageEnergyWhPerKm).toBeCloseTo(8_420 / 649.4, 8);
    expect(document.content).toContain('"day": 1');
    expect(document.content).not.toMatch(/longitude|latitude|track|vehicleId|travel[_I]d|"id"/i);
  });

  it("creates an Excel-friendly CSV with year, month, and daily records", () => {
    const document = createYearSummaryExportDocument({ ...input, format: "csv" });
    const lines = document.content.trim().split("\r\n");
    const header = lines[0]?.slice(1).split(",") ?? [];
    const yearRow = lines[1]?.split(",") ?? [];
    const monthRow = lines[2]?.split(",") ?? [];

    expect(document.fileName).toBe("韭号出行-F90-2026年度摘要.csv");
    expect(header).toContain("average_ride_km");
    expect(header).toContain("average_energy_wh_per_km");
    expect(yearRow[0]).toBe("year");
    expect(Number(yearRow[6])).toBe(31);
    expect(Number(yearRow[10])).toBeCloseTo(649.4 / 31, 8);
    expect(Number(yearRow[11])).toBeCloseTo(8_420 / 649.4, 8);
    expect(monthRow[0]).toBe("month");
    expect(Number(monthRow[10])).toBeCloseTo(649.4 / 31, 8);
    expect(Number(monthRow[11])).toBeCloseTo(8_420 / 649.4, 8);
    expect(document.content).toContain("day,F90,2026,1763793834,202608,1,,12.4");
  });

  it("keeps annual and monthly efficiency unavailable when an active month lacks energy", () => {
    const baseMonth = input.months[0]!;
    const document = createYearSummaryExportDocument({
      ...input,
      months: [
        {
          ...baseMonth,
          summary: { ...baseMonth.summary, energyWh: null, activeDayCount: null },
        },
      ],
    });
    const payload = JSON.parse(document.content) as {
      coverage: {
        energyWh: number | null;
        averageEnergyWhPerKm: number | null;
        activeDayCount: number | null;
      };
      months: Array<{ averageEnergyWhPerKm: number | null }>;
    };

    expect(payload.coverage).toMatchObject({
      energyWh: null,
      averageEnergyWhPerKm: null,
      activeDayCount: null,
    });
    expect(payload.months[0]?.averageEnergyWhPerKm).toBeNull();
  });
});
