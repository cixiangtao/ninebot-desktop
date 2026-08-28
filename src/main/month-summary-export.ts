import type {
  MonthSummaryExportFormat,
  MonthSummaryExportInput,
  RideSpeedVerification,
  RideSummary,
} from "../shared/contracts.js";
import { sanitizeExportBaseName } from "./ride-export.js";

type MaximumSpeedSource = "track" | "declared" | "unverified-capped" | "unavailable";

interface ExportRide extends Omit<RideSummary, "id"> {
  sequence: number;
  averageSpeedKmh: number;
  sampledMaxSpeedKmh: number | null;
  displayedMaxSpeedKmh: number | null;
  maximumSpeedSource: MaximumSpeedSource;
}

const escapeCsvCell = (value: string | number | boolean | null) => {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const isLikelyCappedDeclaration = (
  declaredMaxSpeed: number | null,
  sampledMaxSpeed: number | null,
) =>
  declaredMaxSpeed === 25 &&
  sampledMaxSpeed !== null &&
  Math.abs(sampledMaxSpeed - declaredMaxSpeed) >= 0.5;

const resolveMaximumSpeedSource = (
  declaredMaxSpeed: number | null,
  sampledMaxSpeed: number | null,
): MaximumSpeedSource => {
  if (sampledMaxSpeed !== null) return "track";
  if (declaredMaxSpeed === 25) return "unverified-capped";
  return declaredMaxSpeed === null ? "unavailable" : "declared";
};

const createExportRides = (input: MonthSummaryExportInput): ExportRide[] => {
  const verifications = new Map<string, RideSpeedVerification>(
    input.speedVerifications.map((verification) => [verification.id, verification]),
  );
  return input.month.rides.map((ride, index) => {
    const verification = verifications.get(ride.id);
    const declaredMaxSpeed = verification?.declaredMaxSpeed ?? ride.declaredMaxSpeed;
    const sampledMaxSpeedKmh = verification?.sampledMaxSpeed ?? null;
    const maximumSpeedSource = resolveMaximumSpeedSource(declaredMaxSpeed, sampledMaxSpeedKmh);
    return {
      sequence: index + 1,
      startTime: ride.startTime,
      endTime: ride.endTime,
      mileageKm: ride.mileageKm,
      durationSeconds: ride.durationSeconds,
      declaredMaxSpeed,
      energyWh: ride.energyWh,
      batteryUsedPercent: ride.batteryUsedPercent,
      dayMileageKm: ride.dayMileageKm,
      averageSpeedKmh:
        ride.durationSeconds > 0 ? ride.mileageKm / (ride.durationSeconds / 3_600) : 0,
      sampledMaxSpeedKmh,
      displayedMaxSpeedKmh:
        maximumSpeedSource === "unverified-capped" || maximumSpeedSource === "unavailable"
          ? null
          : (sampledMaxSpeedKmh ?? declaredMaxSpeed),
      maximumSpeedSource,
    };
  });
};

const createCoverage = (input: MonthSummaryExportInput, rides: ExportRide[]) => ({
  rideCount: input.month.summary.rideCount,
  visibleRideCount: input.month.summary.visibleRideCount,
  aggregateAvailable: input.month.summary.aggregateAvailable,
  ridesTruncated: input.month.summary.ridesTruncated,
  verifiedSpeedCount: rides.filter(({ maximumSpeedSource }) => maximumSpeedSource === "track")
    .length,
  correctedSpeedCount: rides.filter(({ declaredMaxSpeed, sampledMaxSpeedKmh }) =>
    isLikelyCappedDeclaration(declaredMaxSpeed, sampledMaxSpeedKmh),
  ).length,
  unverifiedCappedSpeedCount: rides.filter(
    ({ maximumSpeedSource }) => maximumSpeedSource === "unverified-capped",
  ).length,
});

const createCsv = (input: MonthSummaryExportInput) => {
  const rides = createExportRides(input);
  const coverage = createCoverage(input, rides);
  const rows: Array<Array<string | number | boolean | null>> = [
    [
      "record_type",
      "vehicle_name",
      "month",
      "day",
      "sequence",
      "start_time",
      "end_time",
      "ride_count",
      "mileage_km",
      "duration_seconds",
      "energy_wh",
      "battery_used_percent",
      "day_mileage_km",
      "average_speed_kmh",
      "declared_max_speed_kmh",
      "sampled_max_speed_kmh",
      "displayed_max_speed_kmh",
      "maximum_speed_source",
      "visible_ride_count",
      "aggregate_available",
      "rides_truncated",
      "verified_speed_count",
      "corrected_speed_count",
      "unverified_capped_speed_count",
    ],
    [
      "month",
      input.vehicleName,
      input.month.summary.month,
      null,
      null,
      null,
      null,
      input.month.summary.rideCount,
      input.month.summary.mileageKm,
      input.month.summary.durationSeconds,
      input.month.summary.energyWh,
      null,
      null,
      input.month.summary.durationSeconds > 0
        ? input.month.summary.mileageKm / (input.month.summary.durationSeconds / 3_600)
        : 0,
      null,
      null,
      null,
      null,
      input.month.summary.visibleRideCount,
      input.month.summary.aggregateAvailable,
      input.month.summary.ridesTruncated,
      coverage.verifiedSpeedCount,
      coverage.correctedSpeedCount,
      coverage.unverifiedCappedSpeedCount,
    ],
  ];

  for (const { day, mileageKm } of input.month.days) {
    rows.push([
      "day",
      input.vehicleName,
      input.month.summary.month,
      day,
      null,
      null,
      null,
      null,
      mileageKm,
      null,
      null,
      null,
      null,
      null,
      null,
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

  for (const ride of rides) {
    rows.push([
      "ride",
      input.vehicleName,
      input.month.summary.month,
      new Date(ride.startTime * 1_000).getDate(),
      ride.sequence,
      ride.startTime,
      ride.endTime,
      null,
      ride.mileageKm,
      ride.durationSeconds,
      ride.energyWh,
      ride.batteryUsedPercent,
      ride.dayMileageKm,
      ride.averageSpeedKmh,
      ride.declaredMaxSpeed,
      ride.sampledMaxSpeedKmh,
      ride.displayedMaxSpeedKmh,
      ride.maximumSpeedSource,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  }

  return `\uFEFF${rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
};

const createJson = (input: MonthSummaryExportInput) => {
  const rides = createExportRides(input);
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      exportedBy: "骑迹",
      exportedAt: new Date().toISOString(),
      vehicleName: input.vehicleName,
      month: input.month.summary.month,
      summary: {
        ...input.month.summary,
        averageRideKm:
          input.month.summary.rideCount > 0
            ? input.month.summary.mileageKm / input.month.summary.rideCount
            : 0,
        averageEnergyWhPerKm:
          input.month.summary.energyWh !== null && input.month.summary.mileageKm > 0
            ? input.month.summary.energyWh / input.month.summary.mileageKm
            : null,
      },
      coverage: createCoverage(input, rides),
      days: input.month.days.map(({ day, mileageKm }) => ({ day, mileageKm })),
      rides: rides.map((ride) => ({
        sequence: ride.sequence,
        startTime: ride.startTime,
        endTime: ride.endTime,
        mileageKm: ride.mileageKm,
        durationSeconds: ride.durationSeconds,
        energyWh: ride.energyWh,
        batteryUsedPercent: ride.batteryUsedPercent,
        dayMileageKm: ride.dayMileageKm,
        averageSpeedKmh: ride.averageSpeedKmh,
        declaredMaxSpeedKmh: ride.declaredMaxSpeed,
        sampledMaxSpeedKmh: ride.sampledMaxSpeedKmh,
        displayedMaxSpeedKmh: ride.displayedMaxSpeedKmh,
        maximumSpeedSource: ride.maximumSpeedSource,
      })),
    },
    null,
    2,
  )}\n`;
};

export interface MonthSummaryExportDocument {
  content: string;
  fileName: string;
  format: MonthSummaryExportFormat;
}

/** Serializes one loaded month without GPS, vehicle identifiers, or upstream ride identifiers. */
export const createMonthSummaryExportDocument = (
  input: MonthSummaryExportInput,
): MonthSummaryExportDocument => ({
  content: input.format === "csv" ? createCsv(input) : createJson(input),
  fileName: `${sanitizeExportBaseName(`骑迹-${input.vehicleName}-${input.month.summary.month}月度清单`)}.${input.format}`,
  format: input.format,
});
