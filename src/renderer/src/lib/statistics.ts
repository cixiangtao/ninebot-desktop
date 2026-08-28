import type { RideMonthSummary, YearSummaryExportMonth } from "../../../shared/contracts";
import { getMonthFromUnixSeconds } from "./format";

/** Returns only the calendar months that can contain data for a yearly summary request. */
export const createStatisticsMonthKeys = (
  targetYear: number,
  referenceMonth: string,
  historyStartTime: number | null,
) => {
  const referenceYear = Number(referenceMonth.slice(0, 4));
  const lastMonth = targetYear === referenceYear ? Number(referenceMonth.slice(4)) : 12;
  const historyStartMonth =
    historyStartTime === null ? null : getMonthFromUnixSeconds(historyStartTime);
  const historyStartYear =
    historyStartMonth === null ? null : Number(historyStartMonth.slice(0, 4));
  const firstMonth =
    historyStartYear === null || targetYear > historyStartYear
      ? 1
      : targetYear === historyStartYear
        ? Number(historyStartMonth?.slice(4))
        : lastMonth + 1;
  return Array.from(
    { length: Math.max(0, lastMonth - firstMonth + 1) },
    (_, index) => `${targetYear}${String(firstMonth + index).padStart(2, "0")}`,
  );
};

/** Returns the twelve calendar months ending at the supplied reference month. */
export const createRollingStatisticsMonthKeys = (referenceMonth: string) => {
  if (!/^\d{6}$/.test(referenceMonth)) return [];
  const year = Number(referenceMonth.slice(0, 4));
  const month = Number(referenceMonth.slice(4));
  if (!Number.isInteger(year) || month < 1 || month > 12) return [];
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(year, month - 12 + index, 1);
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
};

export interface MonthRideStatistics {
  month: string;
  rideCount: number;
  mileageKm: number;
  durationSeconds: number;
  energyWh: number | null;
  averageEnergyWhPerKm: number | null;
  averageRideKm: number;
  visibleRideCount: number;
  aggregateAvailable: boolean;
  ridesTruncated: boolean;
  activeDayCount: number | null;
  longestDayMileageKm: number | null;
}

export interface YearRideStatistics {
  year: number;
  months: MonthRideStatistics[];
  rideCount: number;
  mileageKm: number;
  durationSeconds: number;
  energyWh: number | null;
  averageEnergyWhPerKm: number | null;
  averageRideKm: number;
  activeMonthCount: number;
  activeDayCount: number | null;
  longestDayMileageKm: number | null;
  aggregateUnavailableMonthCount: number;
  truncatedRideMonthCount: number;
}

export type StatisticsTrendMetric =
  | "mileage"
  | "rides"
  | "averageRide"
  | "energy"
  | "activeDays"
  | "efficiency";

/** Returns a comparable monthly value from ninecli's already-loaded aggregate fields. */
export const getMonthTrendValue = (
  month: MonthRideStatistics,
  metric: StatisticsTrendMetric,
): number | null => {
  switch (metric) {
    case "mileage":
      return month.mileageKm;
    case "rides":
      return month.rideCount;
    case "averageRide":
      return month.averageRideKm;
    case "energy":
      return month.energyWh;
    case "activeDays":
      return month.activeDayCount;
    case "efficiency":
      return month.averageEnergyWhPerKm;
  }
};

export interface YearActivityDay {
  month: string;
  day: number;
  weekday: number;
  weekIndex: number;
  mileageKm: number | null;
}

export interface YearActivityInsights {
  days: YearActivityDay[];
  weekCount: number;
  knownDayCount: number;
  activeDayCount: number;
  maximumMileageKm: number;
  bestDay: YearActivityDay | null;
  longestActiveStreak: number;
  favoriteWeekday: number | null;
}

const getCalendarOrdinal = (year: number, month: number, day: number) =>
  Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);

/** Builds calendar-safe annual activity insights from already-loaded daily mileage. */
export const createYearActivityInsights = (
  year: number,
  months: YearSummaryExportMonth[],
  historyStartTime: number | null,
  referenceTime = Date.now() / 1_000,
): YearActivityInsights => {
  const firstOrdinal = getCalendarOrdinal(year, 1, 1);
  const historyStartDate = historyStartTime === null ? null : new Date(historyStartTime * 1_000);
  const historyStartOrdinal =
    historyStartDate === null
      ? null
      : getCalendarOrdinal(
          historyStartDate.getFullYear(),
          historyStartDate.getMonth() + 1,
          historyStartDate.getDate(),
        );
  const referenceDate = new Date(referenceTime * 1_000);
  const referenceOrdinal = getCalendarOrdinal(
    referenceDate.getFullYear(),
    referenceDate.getMonth() + 1,
    referenceDate.getDate(),
  );
  const januaryFirstWeekday = (new Date(year, 0, 1).getDay() + 6) % 7;
  const days = months
    .flatMap(({ summary, days: monthDays }) => {
      const monthNumber = Number(summary.month.slice(4));
      return monthDays.flatMap(({ day, mileageKm }) => {
        const ordinal = getCalendarOrdinal(year, monthNumber, day);
        if (
          summary.month.slice(0, 4) !== String(year) ||
          (historyStartOrdinal !== null && ordinal < historyStartOrdinal) ||
          ordinal > referenceOrdinal
        ) {
          return [];
        }
        const weekday = (new Date(year, monthNumber - 1, day).getDay() + 6) % 7;
        return [
          {
            month: summary.month,
            day,
            weekday,
            weekIndex: Math.floor((ordinal - firstOrdinal + januaryFirstWeekday) / 7),
            mileageKm,
          },
        ];
      });
    })
    .toSorted(
      (left, right) =>
        getCalendarOrdinal(year, Number(left.month.slice(4)), left.day) -
        getCalendarOrdinal(year, Number(right.month.slice(4)), right.day),
    );
  const activeDays = days.filter(({ mileageKm }) => mileageKm !== null && mileageKm > 0);
  const maximumMileageKm = Math.max(0, ...activeDays.map(({ mileageKm }) => mileageKm ?? 0));
  const bestDay =
    activeDays.toSorted((left, right) => (right.mileageKm ?? 0) - (left.mileageKm ?? 0))[0] ?? null;
  const weekdayActivity = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    activeDayCount: activeDays.filter((day) => day.weekday === weekday).length,
    mileageKm: activeDays
      .filter((day) => day.weekday === weekday)
      .reduce((total, day) => total + (day.mileageKm ?? 0), 0),
  }));
  const favoriteWeekday =
    weekdayActivity
      .toSorted(
        (left, right) =>
          right.activeDayCount - left.activeDayCount || right.mileageKm - left.mileageKm,
      )
      .find(({ activeDayCount }) => activeDayCount > 0)?.weekday ?? null;
  let longestActiveStreak = 0;
  let currentStreak = 0;
  let previousOrdinal: number | null = null;
  for (const day of days) {
    const ordinal = getCalendarOrdinal(year, Number(day.month.slice(4)), day.day);
    if (day.mileageKm !== null && day.mileageKm > 0) {
      currentStreak =
        previousOrdinal !== null && ordinal === previousOrdinal + 1 ? currentStreak + 1 : 1;
      longestActiveStreak = Math.max(longestActiveStreak, currentStreak);
      previousOrdinal = ordinal;
    } else {
      currentStreak = 0;
      previousOrdinal = null;
    }
  }

  return {
    days,
    weekCount: Math.max(1, ...days.map(({ weekIndex }) => weekIndex + 1)),
    knownDayCount: days.filter(({ mileageKm }) => mileageKm !== null).length,
    activeDayCount: activeDays.length,
    maximumMileageKm,
    bestDay,
    longestActiveStreak,
    favoriteWeekday,
  };
};

/** Normalizes one already-parsed month aggregate for the yearly statistics surface. */
export const summarizeRideMonth = (
  month: string,
  summary?: RideMonthSummary,
): MonthRideStatistics => {
  const rideCount = summary?.rideCount ?? 0;
  const mileageKm = summary?.mileageKm ?? 0;
  const energyWh = summary?.energyWh ?? (rideCount === 0 ? 0 : null);
  return {
    month,
    rideCount,
    mileageKm,
    durationSeconds: summary?.durationSeconds ?? 0,
    energyWh,
    averageEnergyWhPerKm: energyWh !== null && mileageKm > 0 ? energyWh / mileageKm : null,
    averageRideKm: rideCount > 0 ? mileageKm / rideCount : 0,
    visibleRideCount: summary?.visibleRideCount ?? 0,
    aggregateAvailable: summary?.aggregateAvailable ?? true,
    ridesTruncated: summary?.ridesTruncated ?? false,
    activeDayCount: summary?.activeDayCount ?? (rideCount === 0 ? 0 : null),
    longestDayMileageKm: summary?.longestDayMileageKm ?? (rideCount === 0 ? 0 : null),
  };
};

/** Normalizes an ordered cross-year month range without changing its calendar sequence. */
export const summarizeRideRange = (
  monthKeys: readonly string[],
  monthSummaries: ReadonlyMap<string, RideMonthSummary>,
) => monthKeys.map((month) => summarizeRideMonth(month, monthSummaries.get(month)));

/** Aggregates already-fetched monthly summaries without loading ride details or GPS trails. */
export const summarizeYearRides = (
  year: number,
  monthSummaries: ReadonlyMap<string, RideMonthSummary>,
): YearRideStatistics => {
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = `${year}${String(index + 1).padStart(2, "0")}`;
    return summarizeRideMonth(month, monthSummaries.get(month));
  });
  const rideCount = months.reduce((total, month) => total + month.rideCount, 0);
  const mileageKm = months.reduce((total, month) => total + month.mileageKm, 0);
  const activeMonths = months.filter(({ rideCount: monthRideCount }) => monthRideCount > 0);
  const energyAvailable = activeMonths.every(({ energyWh }) => energyWh !== null);
  const energyWh = energyAvailable
    ? activeMonths.reduce((total, month) => total + (month.energyWh ?? 0), 0)
    : null;
  const dailyMileageAvailable = activeMonths.every(
    ({ activeDayCount, longestDayMileageKm }) =>
      activeDayCount !== null && longestDayMileageKm !== null,
  );
  return {
    year,
    months,
    rideCount,
    mileageKm,
    durationSeconds: months.reduce((total, month) => total + month.durationSeconds, 0),
    energyWh,
    averageEnergyWhPerKm: energyWh !== null && mileageKm > 0 ? energyWh / mileageKm : null,
    averageRideKm: rideCount > 0 ? mileageKm / rideCount : 0,
    activeMonthCount: activeMonths.length,
    activeDayCount: dailyMileageAvailable
      ? activeMonths.reduce((total, month) => total + (month.activeDayCount ?? 0), 0)
      : null,
    longestDayMileageKm: dailyMileageAvailable
      ? Math.max(0, ...activeMonths.map(({ longestDayMileageKm }) => longestDayMileageKm ?? 0))
      : null,
    aggregateUnavailableMonthCount: months.filter(
      ({ rideCount: monthRideCount, aggregateAvailable }) =>
        monthRideCount > 0 && !aggregateAvailable,
    ).length,
    truncatedRideMonthCount: months.filter(({ ridesTruncated }) => ridesTruncated).length,
  };
};
