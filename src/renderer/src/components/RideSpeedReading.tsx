import type { RideSpeedVerification, RideSummary } from "../../../shared/contracts";
import { resolveTrackPeakSpeed } from "../../../shared/ride-speed";

interface RideSpeedReadingProps {
  ride: RideSummary;
  verification: RideSpeedVerification | null;
}

/** Summary speed stays reference-only; a number here always means a loaded track peak. */
export const RideSpeedReading = ({ ride, verification }: RideSpeedReadingProps) => {
  const peak = resolveTrackPeakSpeed(verification?.sampledMaxSpeed ?? null);
  const source = verification === null ? "unread" : peak === null ? "unavailable" : "track";
  const declared = verification?.declaredMaxSpeed ?? ride.declaredMaxSpeed;
  const reference =
    declared === null ? "接口未提供速度记录" : `接口极速 ${declared} km/h，仅供参考`;
  const description =
    source === "unread"
      ? `轨迹峰值未读取；列表会自动读取附近行程，失败时可使用补全功能重试。${reference}。`
      : peak === null
        ? `轨迹峰值不可用：详情未提供有效速度采样。${reference}。`
        : `轨迹峰值 ${Math.round(peak)} km/h，取自返回的轨迹速度采样最大值。${reference}。`;
  return (
    <span
      className="ride-speed-reading"
      data-source={source}
      aria-label={description}
      title={description}
    >
      {peak === null ? (
        <strong className="ride-speed-unavailable">—</strong>
      ) : (
        <>
          <strong>{Math.round(peak)}</strong>
          <small>km/h</small>
        </>
      )}
    </span>
  );
};
