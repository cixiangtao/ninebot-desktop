import { describe, expect, it } from "vitest";
import type { RideMonthSummary, YearSummaryExportMonth } from "../../../shared/contracts";
import {
  createRollingStatisticsMonthKeys,
  createStatisticsMonthKeys,
  createYearActivityInsights,
  getMonthTrendValue,
  summarizeRideMonth,
  summarizeRideRange,
  summarizeYearRides,
} from "./statistics";

const createMonth = (
  month: string,
  rideCount: number,
  mileageKm: number,
  energyWh: number | null,
  overrides: Partial<RideMonthSummary> = {},
): RideMonthSummary => ({
  month,
  historyStartTime: 1_735_689_600,
  rideCount,
  mileageKm,
  durationSeconds: rideCount * 600,
  energyWh,
  visibleRideCount: Math.min(rideCount, 20),
  aggregateAvailable: true,
  ridesTruncated: rideCount > 20,
  activeDayCount: rideCount > 0 ? Math.min(rideCount, 18) : 0,
  longestDayMileageKm: rideCount > 0 ? mileageKm / Math.min(rideCount, 18) : 0,
  ...overrides,
});

describe("ride statistics", () => {
  it("requests only months between the vehicle history start and the current month", () => {
    const historyStartTime = new Date(2025, 10, 22, 12).getTime() / 1000;
    expect(createStatisticsMonthKeys(2024, "202608", historyStartTime)).toEqual([]);
    expect(createStatisticsMonthKeys(2025, "202608", historyStartTime)).toEqual([
      "202511",
      "202512",
    ]);
    expect(createStatisticsMonthKeys(2026, "202608", historyStartTime)).toEqual([
      "202601",
      "202602",
      "202603",
      "202604",
      "202605",
      "202606",
      "202607",
      "202608",
    ]);
    expect(createStatisticsMonthKeys(2026, "202608", null)).toHaveLength(8);
  });

  it("builds one chronological rolling year across the calendar boundary", () => {
    expect(createRollingStatisticsMonthKeys("202608")).toEqual([
      "202509",
      "202510",
      "202511",
      "202512",
      "202601",
      "202602",
      "202603",
      "202604",
      "202605",
      "202606",
      "202607",
      "202608",
    ]);
    expect(createRollingStatisticsMonthKeys("invalid")).toEqual([]);
  });

  it("keeps rolling range order and explicit empty months", () => {
    const months = summarizeRideRange(
      ["202511", "202512", "202601"],
      new Map([
        ["202511", createMonth("202511", 2, 18, 504)],
        ["202601", createMonth("202601", 1, 9, 252)],
      ]),
    );

    expect(months.map(({ month }) => month)).toEqual(["202511", "202512", "202601"]);
    expect(months.map(({ rideCount }) => rideCount)).toEqual([2, 0, 1]);
  });

  it("uses complete month aggregates even when selectable rows are capped", () => {
    expect(summarizeRideMonth("202608", createMonth("202608", 42, 210, 5_880))).toMatchObject({
      rideCount: 42,
      mileageKm: 210,
      durationSeconds: 25_200,
      energyWh: 5_880,
      averageRideKm: 5,
      averageEnergyWhPerKm: 28,
      visibleRideCount: 20,
      aggregateAvailable: true,
      ridesTruncated: true,
      activeDayCount: 18,
      longestDayMileageKm: 210 / 18,
    });
  });

  it("aggregates complete month totals while keeping empty months explicit", () => {
    const statistics = summarizeYearRides(
      2026,
      new Map([
        ["202601", createMonth("202601", 1, 8, 224)],
        ["202602", createMonth("202602", 2, 18, 522)],
      ]),
    );
    expect(statistics.months).toHaveLength(12);
    expect(statistics).toMatchObject({
      year: 2026,
      rideCount: 3,
      mileageKm: 26,
      durationSeconds: 1_800,
      energyWh: 746,
      averageEnergyWhPerKm: 746 / 26,
      averageRideKm: 26 / 3,
      activeMonthCount: 2,
      activeDayCount: 3,
      longestDayMileageKm: 9,
      aggregateUnavailableMonthCount: 0,
      truncatedRideMonthCount: 0,
    });
  });

  it("keeps aggregate and energy gaps explicit", () => {
    const statistics = summarizeYearRides(
      2026,
      new Map([
        [
          "202601",
          createMonth("202601", 20, 100, null, {
            aggregateAvailable: false,
            ridesTruncated: true,
          }),
        ],
      ]),
    );
    expect(statistics.energyWh).toBeNull();
    expect(statistics.averageEnergyWhPerKm).toBeNull();
    expect(statistics.aggregateUnavailableMonthCount).toBe(1);
    expect(statistics.truncatedRideMonthCount).toBe(1);
  });

  it("keeps missing daily mileage explicit instead of estimating active days", () => {
    const statistics = summarizeYearRides(
      2026,
      new Map([
        [
          "202601",
          createMonth("202601", 4, 40, 1_120, {
            activeDayCount: null,
            longestDayMileageKm: null,
          }),
        ],
      ]),
    );
    expect(statistics.activeDayCount).toBeNull();
    expect(statistics.longestDayMileageKm).toBeNull();
  });

  it("exposes every monthly aggregate as a trend without inventing missing values", () => {
    const month = summarizeRideMonth(
      "202601",
      createMonth("202601", 4, 40, 1_120, { activeDayCount: 3 }),
    );
    expect(getMonthTrendValue(month, "mileage")).toBe(40);
    expect(getMonthTrendValue(month, "rides")).toBe(4);
    expect(getMonthTrendValue(month, "averageRide")).toBe(10);
    expect(getMonthTrendValue(month, "energy")).toBe(1_120);
    expect(getMonthTrendValue(month, "activeDays")).toBe(3);
    expect(getMonthTrendValue(month, "efficiency")).toBe(28);

    const incomplete = summarizeRideMonth(
      "202602",
      createMonth("202602", 2, 18, null, { activeDayCount: null }),
    );
    expect(getMonthTrendValue(incomplete, "energy")).toBeNull();
    expect(getMonthTrendValue(incomplete, "averageRide")).toBe(9);
    expect(getMonthTrendValue(incomplete, "activeDays")).toBeNull();
    expect(getMonthTrendValue(incomplete, "efficiency")).toBeNull();
  });

  it("derives annual activity records within the real history and current-date boundaries", () => {
    const months = [
      {
        summary: createMonth("202601", 5, 30, 840),
        days: [0, 4, 5, 0, 6, 7, 8].map((mileageKm, index) => ({
          day: index + 1,
          mileageKm,
        })),
      },
    ] satisfies YearSummaryExportMonth[];
    const insights = createYearActivityInsights(
      2026,
      months,
      new Date(2026, 0, 2, 12).getTime() / 1_000,
      new Date(2026, 0, 7, 12).getTime() / 1_000,
    );

    expect(insights).toMatchObject({
      knownDayCount: 6,
      activeDayCount: 5,
      maximumMileageKm: 8,
      longestActiveStreak: 3,
      favoriteWeekday: 2,
      bestDay: { month: "202601", day: 7, mileageKm: 8 },
    });
    expect(insights.days.map(({ day }) => day)).toEqual([2, 3, 4, 5, 6, 7]);
  });
});
