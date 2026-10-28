import { ChevronDown, LoaderCircle, ScanSearch } from "lucide-react";

interface RideSpeedVerificationPanelProps {
  totalCount: number;
  verifiedCount: number;
  failedCount: number;
  unavailableCount: number;
  loading: boolean;
  error: string | null;
  disabled: boolean;
  onVerify: () => void;
}

/** Viewport reads are automatic; the button optionally completes the remaining month. */
export const RideSpeedVerificationPanel = ({
  totalCount,
  verifiedCount,
  failedCount,
  unavailableCount,
  loading,
  error,
  disabled,
  onVerify,
}: RideSpeedVerificationPanelProps) => {
  const completed = totalCount > 0 && verifiedCount >= totalCount;
  const statusText = loading
    ? `正在自动读取轨迹 · 已读取 ${verifiedCount}/${totalCount} 条`
    : error
      ? `读取失败：${error}`
      : `已读取 ${verifiedCount}/${totalCount} 条${unavailableCount > 0 ? ` · ${unavailableCount} 条无有效采样` : ""}${failedCount > 0 ? ` · ${failedCount} 条失败，可重试` : ""}`;

  return (
    <section className="ride-speed-verification" aria-label="本月轨迹峰值">
      <details className="ride-speed-verification-help">
        <summary title="查看轨迹峰值说明">
          {loading ? <LoaderCircle size={14} className="animate-spin" /> : <ScanSearch size={14} />}
          <span role="status" title={statusText}>
            {loading ? "读取峰值中" : failedCount > 0 ? "峰值读取失败" : "轨迹峰值"}
          </span>
          <ChevronDown size={12} className="ride-speed-help-chevron" aria-hidden="true" />
        </summary>
        <p>{statusText}</p>
        <small>
          列表会自动读取可见及附近行程，最多同时读取 2
          条；已读取的结果会复用。补全未读可读取本月其余行程并重试失败项。峰值只取轨迹速度采样。
        </small>
      </details>
      <button type="button" onClick={onVerify} disabled={disabled || loading || completed}>
        {loading ? "读取中" : completed ? "已补全" : "补全未读"}
      </button>
    </section>
  );
};
