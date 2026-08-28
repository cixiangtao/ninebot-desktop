import type { YearSummaryExportFormat, YearSummaryExportInput } from "../shared/contracts.js";
import { sanitizeExportBaseName } from "./ride-export.js";

const escapeCsvCell = (value: string | number | boolean | null) => {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

interface YearExportAggregate {
  monthCount: number;
  activeMonthCount: number;
  rideCount: number;
  mileageKm: number;
  durationSeconds: number;
  energyWh: number | null;
  averageRideKm: number;
  averageEnergyWhPerKm: number | null;
  activeDayCount: number | null;
  longestDayMileageKm: number | null;
  visibleRideCount: number;
  truncatedMonthCount: number;
  aggregateUnavailableMonthCount: number;
  aggregateAvailable: boolean;
  ridesTruncated: boolean;
}

/** Builds one annual export summary while preserving unknown active-month energy and day totals. */
const summarizeExportYear = (input: YearSummaryExportInput): YearExportAggregate => {
  const summaries = input.months.map(({ summary }) => summary);
  const activeSummaries = summaries.filter(({ rideCount }) => rideCount > 0);
  const rideCount = summaries.reduce((total, { rideCount: count }) => total + count, 0);
  const mileageKm = summaries.reduce((total, summary) => total + summary.mileageKm, 0);
  const energyAvailable = activeSummaries.every(({ energyWh }) => energyWh !== null);
  const energyWh = energyAvailable
    ? activeSummaries.reduce((total, summary) => total + (summary.energyWh ?? 0), 0)
    : null;
  const activeDaysAvailable = activeSummaries.every(
    ({ activeDayCount }) => activeDayCount !== null,
  );
  const longestDayAvailable = activeSummaries.every(
    ({ longestDayMileageKm }) => longestDayMileageKm !== null,
  );
  const aggregateUnavailableMonthCount = summaries.filter(
    ({ aggregateAvailable }) => !aggregateAvailable,
  ).length;
  const truncatedMonthCount = summaries.filter(({ ridesTruncated }) => ridesTruncated).length;

  return {
    monthCount: summaries.length,
    activeMonthCount: activeSummaries.length,
    rideCount,
    mileageKm,
    durationSeconds: summaries.reduce((total, summary) => total + summary.durationSeconds, 0),
    energyWh,
    averageRideKm: rideCount > 0 ? mileageKm / rideCount : 0,
    averageEnergyWhPerKm: energyWh !== null && mileageKm > 0 ? energyWh / mileageKm : null,
    activeDayCount: activeDaysAvailable
      ? activeSummaries.reduce((total, summary) => total + (summary.activeDayCount ?? 0), 0)
      : null,
    longestDayMileageKm: longestDayAvailable
      ? Math.max(0, ...activeSummaries.map(({ longestDayMileageKm }) => longestDayMileageKm ?? 0))
      : null,
    visibleRideCount: summaries.reduce((total, summary) => total + summary.visibleRideCount, 0),
    truncatedMonthCount,
    aggregateUnavailableMonthCount,
    aggregateAvailable: aggregateUnavailableMonthCount === 0,
    ridesTruncated: truncatedMonthCount > 0,
  };
};

const createCsv = (input: YearSummaryExportInput) => {
  const aggregate = summarizeExportYear(input);
  const rows: Array<Array<string | number | boolean | null>> = [
    [
      "record_type",
      "vehicle_name",
      "year",
      "history_start_time",
      "month",
      "day",
      "ride_count",
      "mileage_km",
      "duration_seconds",
      "energy_wh",
      "average_ride_km",
      "average_energy_wh_per_km",
      "active_day_count",
      "longest_day_mileage_km",
      "visible_ride_count",
      "aggregate_available",
      "rides_truncated",
    ],
    [
      "year",
      input.vehicleName,
      input.year,
      input.historyStartTime,
      null,
      null,
      aggregate.rideCount,
      aggregate.mileageKm,
      aggregate.durationSeconds,
      aggregate.energyWh,
      aggregate.averageRideKm,
      aggregate.averageEnergyWhPerKm,
      aggregate.activeDayCount,
      aggregate.longestDayMileageKm,
      aggregate.visibleRideCount,
      aggregate.aggregateAvailable,
      aggregate.ridesTruncated,
    ],
  ];

  for (const { summary, days } of input.months) {
    const averageRideKm = summary.rideCount > 0 ? summary.mileageKm / summary.rideCount : 0;
    const averageEnergyWhPerKm =
      summary.energyWh !== null && summary.mileageKm > 0
        ? summary.energyWh / summary.mileageKm
        : null;
    rows.push([
      "month",
      input.vehicleName,
      input.year,
      input.historyStartTime,
      summary.month,
      null,
      summary.rideCount,
      summary.mileageKm,
      summary.durationSeconds,
      summary.energyWh,
      averageRideKm,
      averageEnergyWhPerKm,
      summary.activeDayCount,
      summary.longestDayMileageKm,
      summary.visibleRideCount,
      summary.aggregateAvailable,
      summary.ridesTruncated,
    ]);
    for (const day of days) {
      rows.push([
        "day",
        input.vehicleName,
        input.year,
        input.historyStartTime,
        summary.month,
        day.day,
        null,
        day.mileageKm,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      ]);
    }
  }

  return `\uFEFF${rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
};

const createJson = (input: YearSummaryExportInput) => {
  const coverage = summarizeExportYear(input);

  return `${JSON.stringify(
    {
      schemaVersion: 2,
      exportedBy: "骑迹",
      exportedAt: new Date().toISOString(),
      vehicleName: input.vehicleName,
      year: input.year,
      historyStartTime: input.historyStartTime,
      coverage,
      months: input.months.map(({ summary, days }) => ({
        month: summary.month,
        historyStartTime: summary.historyStartTime,
        rideCount: summary.rideCount,
        mileageKm: summary.mileageKm,
        durationSeconds: summary.durationSeconds,
        energyWh: summary.energyWh,
        averageRideKm: summary.rideCount > 0 ? summary.mileageKm / summary.rideCount : 0,
        averageEnergyWhPerKm:
          summary.energyWh !== null && summary.mileageKm > 0
            ? summary.energyWh / summary.mileageKm
            : null,
        activeDayCount: summary.activeDayCount,
        longestDayMileageKm: summary.longestDayMileageKm,
        visibleRideCount: summary.visibleRideCount,
        aggregateAvailable: summary.aggregateAvailable,
        ridesTruncated: summary.ridesTruncated,
        days: days.map(({ day, mileageKm }) => ({ day, mileageKm })),
      })),
    },
    null,
    2,
  )}\n`;
};

export interface YearSummaryExportDocument {
  content: string;
  fileName: string;
  format: YearSummaryExportFormat;
}

/** Serializes already-loaded annual aggregates without GPS, SNs, or ride identifiers. */
export const createYearSummaryExportDocument = (
  input: YearSummaryExportInput,
): YearSummaryExportDocument => ({
  content: input.format === "csv" ? createCsv(input) : createJson(input),
  fileName: `${sanitizeExportBaseName(`骑迹-${input.vehicleName}-${input.year}年度摘要`)}.${input.format}`,
  format: input.format,
});
