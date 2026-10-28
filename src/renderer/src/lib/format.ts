const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const formatRideDate = (unixSeconds: number) =>
  dateFormatter.format(new Date(unixSeconds * 1000));

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const yearDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Formats local ride endpoints, retaining the end date across midnight and year boundaries. */
export const formatRideTimeRange = (
  startTime: number,
  endTime: number,
  options: { date?: "always" | "cross-day" } = {},
) => {
  const start = new Date(startTime * 1000);
  const end = new Date(endTime * 1000);
  const startValid = startTime > 0 && Number.isFinite(start.getTime());
  const endValid =
    endTime > 0 && Number.isFinite(end.getTime()) && (!startValid || endTime >= startTime);
  if (!startValid) return `—～${endValid ? dateFormatter.format(end) : "—"}`;
  if (!endValid) return `${dateFormatter.format(start)}～—`;
  if (start.getFullYear() !== end.getFullYear())
    return `${yearDateFormatter.format(start)}～${yearDateFormatter.format(end)}`;
  const sameDay = start.getMonth() === end.getMonth() && start.getDate() === end.getDate();
  const startFormatter = sameDay && options.date === "cross-day" ? timeFormatter : dateFormatter;
  return `${startFormatter.format(start)}～${(sameDay ? timeFormatter : dateFormatter).format(end)}`;
};

export const formatDuration = (seconds: number) => {
  const roundedSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(roundedSeconds / 60);
  const remaining = roundedSeconds % 60;
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
};

export const formatLongDuration = (seconds: number) => {
  const roundedSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(roundedSeconds / 60);
  const remaining = roundedSeconds % 60;
  return `${minutes}分${remaining.toString().padStart(2, "0")}秒`;
};

/** Minute-level summary for dense lists; exact seconds remain available in ride details. */
export const formatRideListDuration = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds === 0) return "0min";
  if (seconds < 60) return "<1min";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0 ? `${hours}h` : `${hours}h ${String(remaining).padStart(2, "0")}min`;
};

export const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
};

export const formatMonth = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(4))}月`;

export const createMonthKey = (year: number, month: number) =>
  `${year}${String(month).padStart(2, "0")}`;

export const getMonthYear = (month: string) => Number(month.slice(0, 4));

export const getMonthNumber = (month: string) => Number(month.slice(4));

/** Converts a Unix timestamp to the month key used by the local desktop calendar. */
export const getMonthFromUnixSeconds = (unixSeconds: number) => {
  const date = new Date(unixSeconds * 1000);
  return createMonthKey(date.getFullYear(), date.getMonth() + 1);
};

export const formatHistoryStartDate = (unixSeconds: number) => {
  const date = new Date(unixSeconds * 1000);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
};

export const isFutureMonth = (month: string, referenceMonth = currentMonth()) =>
  month > referenceMonth;

export { resolveTrackPeakSpeed as resolveDisplayedMaxSpeed } from "../../../shared/ride-speed";

/** Calculates ride energy efficiency only when both upstream measurements are usable. */
export const calculateRideEnergyEfficiency = (energyWh: number | null, mileageKm: number) =>
  energyWh !== null &&
  Number.isFinite(energyWh) &&
  energyWh >= 0 &&
  Number.isFinite(mileageKm) &&
  mileageKm > 0
    ? energyWh / mileageKm
    : null;

/** Calculates the ride's share of its complete calendar-day mileage when totals are consistent. */
export const calculateRideDayShare = (rideMileageKm: number, dayMileageKm: number | null) => {
  if (
    dayMileageKm === null ||
    !Number.isFinite(dayMileageKm) ||
    dayMileageKm <= 0 ||
    !Number.isFinite(rideMileageKm) ||
    rideMileageKm < 0 ||
    rideMileageKm > dayMileageKm + 0.1
  ) {
    return null;
  }
  return Math.min(100, (rideMileageKm / dayMileageKm) * 100);
};

/**
 * Older Ninebot monthly summaries can return a fixed 25 km/h even when the
 * detailed trail contains a different observed peak. Treat that mismatch as
 * an upstream cap/placeholder instead of presenting both values as peers.
 */
export const isLikelyCappedMaxSpeedDeclaration = (
  sampledMaxSpeed: number | null,
  declaredMaxSpeed: number | null,
) =>
  sampledMaxSpeed !== null &&
  declaredMaxSpeed === 25 &&
  Math.abs(sampledMaxSpeed - declaredMaxSpeed) >= 0.5;
