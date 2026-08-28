import { LoaderCircle, ScanSearch } from "lucide-react";

interface RideSpeedVerificationPanelProps {
  totalCount: number;
  verifiedCount: number;
  correctedCount: number;
  failedCount: number;
  placeholderCount: number;
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onVerify: () => void;
}

/** Presents the explicit, GPS-detail-backed monthly maximum-speed verification action. */
export const RideSpeedVerificationPanel = ({
  totalCount,
  verifiedCount,
  correctedCount,
  failedCount,
  placeholderCount,
  loading,
  error,
  disabled,
  onVerify,
}: RideSpeedVerificationPanelProps) => {
  const completed = totalCount > 0 && verifiedCount + failedCount >= totalCount;
  const statusText = loading
    ? `正在校验 ${totalCount} 条可选行程…`
    : error
      ? `校验失败：${error}`
      : verifiedCount > 0
        ? `已校验 ${verifiedCount}/${totalCount} 条${correctedCount > 0 ? ` · 纠正 ${correctedCount} 条旧摘要` : ""}${placeholderCount > 0 ? ` · ${placeholderCount} 条仍无轨迹依据` : ""}${failedCount > 0 ? ` · ${failedCount} 条失败` : ""}`
        : placeholderCount > 0
          ? `发现 ${placeholderCount} 条 25 km/h 旧摘要，校验后显示轨迹极速`
          : "尚未批量校验";

  return (
    <section className="ride-speed-verification" aria-label="本月极速校验">
      <div className="ride-speed-verification-heading">
        <span>
          {loading ? <LoaderCircle size={14} className="animate-spin" /> : <ScanSearch size={14} />}
          <strong>本月极速校验</strong>
        </span>
        <button type="button" onClick={onVerify} disabled={disabled || loading}>
          {loading ? "校验中" : completed ? "重新校验" : "校验全部"}
        </button>
      </div>
      <p className={error ? "ride-speed-verification-error" : undefined} role="status">
        {statusText}
      </p>
      <small>仅在你操作后读取最多 20 条轨迹详情；页面只接收速度摘要。</small>
    </section>
  );
};
