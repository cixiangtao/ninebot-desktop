import type { RideDetail } from "../../../shared/contracts";
import { calculateRideEnergyEfficiency, resolveDisplayedMaxSpeed } from "./format";

export type RideComparisonMetricKey =
  | "maximumSpeed"
  | "averageSpeed"
  | "mileage"
  | "duration"
  | "energy"
  | "efficiency"
  | "batteryUsed";

export interface RideComparisonMetric {
  key: RideComparisonMetricKey;
  label: string;
  unit: "km/h" | "km" | "time" | "Wh" | "Wh/km" | "%";
  precision: number;
  baseValue: number | null;
  comparisonValue: number | null;
  /** Comparison ride minus the currently selected base ride. */
  delta: number | null;
}

/** Builds comparable ride metrics while preserving the sampled-first maximum-speed rule. */
export const createRideComparisonMetrics = (
  base: RideDetail,
  comparison: RideDetail,
): RideComparisonMetric[] => {
  const rows = [
    {
      key: "maximumSpeed",
      label: "轨迹实测极速",
      unit: "km/h",
      precision: 0,
      baseValue: resolveDisplayedMaxSpeed(base.sampledMaxSpeed, base.declaredMaxSpeed),
      comparisonValue: resolveDisplayedMaxSpeed(
        comparison.sampledMaxSpeed,
        comparison.declaredMaxSpeed,
      ),
    },
    {
      key: "averageSpeed",
      label: "平均速度",
      unit: "km/h",
      precision: 1,
      baseValue: base.averageSpeed,
      comparisonValue: comparison.averageSpeed,
    },
    {
      key: "mileage",
      label: "里程",
      unit: "km",
      precision: 1,
      baseValue: base.mileageKm,
      comparisonValue: comparison.mileageKm,
    },
    {
      key: "duration",
      label: "用时",
      unit: "time",
      precision: 0,
      baseValue: base.durationSeconds,
      comparisonValue: comparison.durationSeconds,
    },
    {
      key: "energy",
      label: "本次能耗",
      unit: "Wh",
      precision: 0,
      baseValue: base.energyWh,
      comparisonValue: comparison.energyWh,
    },
    {
      key: "efficiency",
      label: "平均能耗",
      unit: "Wh/km",
      precision: 1,
      baseValue: calculateRideEnergyEfficiency(base.energyWh, base.mileageKm),
      comparisonValue: calculateRideEnergyEfficiency(comparison.energyWh, comparison.mileageKm),
    },
    {
      key: "batteryUsed",
      label: "电量消耗",
      unit: "%",
      precision: 1,
      baseValue: base.batteryUsedPercent,
      comparisonValue: comparison.batteryUsedPercent,
    },
  ] as const satisfies ReadonlyArray<Omit<RideComparisonMetric, "delta">>;

  return rows.map((row) => ({
    ...row,
    delta:
      row.baseValue === null || row.comparisonValue === null
        ? null
        : row.comparisonValue - row.baseValue,
  }));
};

/** Formats a signed decimal delta without implying whether the change is better or worse. */
export const formatSignedDecimal = (value: number, precision: number) => {
  const finiteValue = Number.isFinite(value) ? value : 0;
  const roundedValue = Number(finiteValue.toFixed(precision));
  const sign = roundedValue > 0 ? "+" : roundedValue < 0 ? "−" : "";
  return `${sign}${Math.abs(roundedValue).toFixed(precision)}`;
};

/** Formats a signed duration delta expressed in seconds. */
export const formatSignedDuration = (seconds: number) => {
  const roundedSeconds = Math.round(Number.isFinite(seconds) ? seconds : 0);
  if (roundedSeconds === 0) return "0秒";
  const sign = roundedSeconds > 0 ? "+" : "−";
  const absoluteSeconds = Math.abs(roundedSeconds);
  const minutes = Math.floor(absoluteSeconds / 60);
  const remainingSeconds = absoluteSeconds % 60;
  return `${sign}${minutes > 0 ? `${minutes}分` : ""}${remainingSeconds.toString().padStart(2, "0")}秒`;
};
