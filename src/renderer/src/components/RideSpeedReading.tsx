import type { RideSpeedVerification, RideSummary } from "../../../shared/contracts";
import { isLikelyCappedMaxSpeedDeclaration } from "../lib/format";

interface RideSpeedReadingProps {
  ride: RideSummary;
  verification: RideSpeedVerification | null;
}

/**
 * Displays a ride-list maximum only when its source is trustworthy enough to identify.
 *
 * Ninebot can return 25 km/h as a historical month-row placeholder. Until a trail sample
 * confirms or contradicts it, the numeric value stays hidden instead of posing as a real peak.
 */
export const RideSpeedReading = ({ ride, verification }: RideSpeedReadingProps) => {
  const sampled = verification?.sampledMaxSpeed ?? null;
  const declared = verification?.declaredMaxSpeed ?? ride.declaredMaxSpeed;
  const unresolvedPlaceholder = sampled === null && declared === 25;
  const displayed = unresolvedPlaceholder ? null : (sampled ?? declared);
  const corrected = isLikelyCappedMaxSpeedDeclaration(sampled, declared);
  const source = unresolvedPlaceholder
    ? "placeholder"
    : verification
      ? "track"
      : declared === null
        ? "unavailable"
        : "summary";
  const status = unresolvedPlaceholder
    ? verification
      ? "无轨迹"
      : "待校验"
    : verification
      ? corrected
        ? "已纠正"
        : sampled !== null
          ? "轨迹"
          : "摘要"
      : declared === null
        ? "无摘要"
        : "摘要";
  const accessibleLabel = unresolvedPlaceholder
    ? verification
      ? "最高速度无法校验，轨迹没有速度采样，接口摘要25公里每小时未采用"
      : "最高速度待校验，接口摘要25公里每小时未采用"
    : `最高速度${displayed === null ? "不可用" : `${Math.round(displayed)}公里每小时`}，${status}`;

  return (
    <span
      className={`ride-speed-reading ${corrected ? "ride-speed-reading-corrected" : ""}`}
      data-source={source}
      aria-label={accessibleLabel}
    >
      <strong>{displayed === null ? "—" : Math.round(displayed)}</strong>
      <small>km/h</small>
      <em>{status}</em>
    </span>
  );
};
