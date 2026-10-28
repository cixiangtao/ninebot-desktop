import { describe, expect, it } from "vitest";
import {
  calculateRideDayShare,
  calculateRideEnergyEfficiency,
  createMonthKey,
  formatDuration,
  formatHistoryStartDate,
  formatLongDuration,
  formatMonth,
  formatRideDate,
  formatRideTimeRange,
  getMonthNumber,
  getMonthFromUnixSeconds,
  getMonthYear,
  isLikelyCappedMaxSpeedDeclaration,
  isFutureMonth,
  resolveDisplayedMaxSpeed,
} from "./format";

const seconds = (year: number, month: number, day: number, hour: number, minute: number) =>
  new Date(year, month - 1, day, hour, minute).getTime() / 1000;

describe("ride time ranges", () => {
  it("shows the start date and both times for a same-day ride", () => {
    const start = seconds(2026, 10, 28, 18, 10);
    expect(formatRideTimeRange(start, seconds(2026, 10, 28, 18, 30))).toBe(
      `${formatRideDate(start)}～18:30`,
    );
  });

  it("retains the end date and both years when crossing calendar boundaries", () => {
    const start = seconds(2026, 10, 28, 23, 50);
    const end = seconds(2026, 10, 29, 0, 20);
    expect(formatRideTimeRange(start, end)).toBe(
      `${formatRideDate(start)}～${formatRideDate(end)}`,
    );
    const newYear = formatRideTimeRange(seconds(2026, 12, 31, 23, 50), seconds(2027, 1, 1, 0, 20));
    expect(newYear).toContain("2026");
    expect(newYear).toContain("2027");
  });

  it("does not invent an end time when it is missing or precedes the start", () => {
    const start = seconds(2026, 10, 28, 18, 10);
    expect(formatRideTimeRange(start, 0)).toBe(`${formatRideDate(start)}～—`);
    expect(formatRideTimeRange(start, start - 60)).toBe(`${formatRideDate(start)}～—`);
  });
});

describe("duration formatting", () => {
  it("carries rounded seconds into the next minute", () => {
    expect(formatDuration(59.6)).toBe("1:00");
    expect(formatLongDuration(119.6)).toBe("2分00秒");
  });

  it("clamps negative interpolated values", () => {
    expect(formatDuration(-0.4)).toBe("0:00");
  });
});

describe("ride energy efficiency", () => {
  it("calculates Wh/km while preserving missing and zero-distance states", () => {
    expect(calculateRideEnergyEfficiency(231, 7.7)).toBe(30);
    expect(calculateRideEnergyEfficiency(0, 7.7)).toBe(0);
    expect(calculateRideEnergyEfficiency(null, 7.7)).toBeNull();
    expect(calculateRideEnergyEfficiency(231, 0)).toBeNull();
    expect(calculateRideEnergyEfficiency(-1, 7.7)).toBeNull();
  });
});

describe("ride day context", () => {
  it("calculates a bounded share only for consistent complete day mileage", () => {
    expect(calculateRideDayShare(12.6, 39.4)).toBeCloseTo(31.98, 2);
    expect(calculateRideDayShare(12.6, 12.55)).toBe(100);
    expect(calculateRideDayShare(12.6, 10)).toBeNull();
    expect(calculateRideDayShare(12.6, null)).toBeNull();
    expect(calculateRideDayShare(0, 0)).toBeNull();
  });
});

describe("month formatting", () => {
  it("creates and reads stable YYYYMM month keys", () => {
    expect(createMonthKey(2026, 2)).toBe("202602");
    expect(getMonthYear("202602")).toBe(2026);
    expect(getMonthNumber("202602")).toBe(2);
    expect(formatMonth("202602")).toBe("2026年2月");
  });

  it("only marks months after the reference month as future", () => {
    expect(isFutureMonth("202609", "202608")).toBe(true);
    expect(isFutureMonth("202608", "202608")).toBe(false);
    expect(isFutureMonth("202512", "202608")).toBe(false);
  });

  it("derives a stable local history boundary from an upstream timestamp", () => {
    const historyStartTime = new Date(2025, 10, 22, 12).getTime() / 1000;
    expect(getMonthFromUnixSeconds(historyStartTime)).toBe("202511");
    expect(formatHistoryStartDate(historyStartTime)).toBe("2025年11月22日");
  });
});

describe("maximum speed display", () => {
  it("prefers the observed track maximum over a capped upstream declaration", () => {
    expect(resolveDisplayedMaxSpeed(70)).toBe(70);
    expect(resolveDisplayedMaxSpeed(23)).toBe(23);
  });

  it("keeps unknown distinct from an observed zero without a summary fallback", () => {
    expect(resolveDisplayedMaxSpeed(null)).toBeNull();
    expect(resolveDisplayedMaxSpeed(0)).toBe(0);
    expect(resolveDisplayedMaxSpeed(Number.NaN)).toBeNull();
    expect(resolveDisplayedMaxSpeed(-1)).toBeNull();
  });

  it("identifies the historical 25 km/h summary cap only when trail evidence disagrees", () => {
    expect(isLikelyCappedMaxSpeedDeclaration(70, 25)).toBe(true);
    expect(isLikelyCappedMaxSpeedDeclaration(23, 25)).toBe(true);
    expect(isLikelyCappedMaxSpeedDeclaration(25, 25)).toBe(false);
    expect(isLikelyCappedMaxSpeedDeclaration(null, 25)).toBe(false);
    expect(isLikelyCappedMaxSpeedDeclaration(70, 70)).toBe(false);
  });
});
