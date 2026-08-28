import {
  FileJson2,
  FileSpreadsheet,
  Gauge,
  LoaderCircle,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import type { MonthSummaryExportFormat } from "../../../shared/contracts";
import { formatMonth } from "../lib/format";

interface MonthSummaryExportSheetProps {
  open: boolean;
  busy: boolean;
  activeFormat: MonthSummaryExportFormat | null;
  error: string | null;
  vehicleName: string;
  month: string;
  rideCount: number;
  visibleRideCount: number;
  verifiedSpeedCount: number;
  unresolvedCappedSpeedCount: number;
  ridesTruncated: boolean;
  onClose: () => void;
  onExport: (format: MonthSummaryExportFormat) => Promise<void>;
}

const exportOptions = [
  {
    format: "csv",
    icon: <FileSpreadsheet size={20} />,
    title: "CSV 表格",
    description: "完整月汇总、每日里程和可选行程分行保存，适合 Excel 分析",
  },
  {
    format: "json",
    icon: <FileJson2 size={20} />,
    title: "JSON 数据",
    description: "保留汇总、日期、行程与极速依据，适合编程和 AI 分析",
  },
] as const satisfies ReadonlyArray<{
  format: MonthSummaryExportFormat;
  icon: ReactNode;
  title: string;
  description: string;
}>;

/** Explains month coverage and speed provenance before opening the native save dialog. */
export const MonthSummaryExportSheet = ({
  open,
  busy,
  activeFormat,
  error,
  vehicleName,
  month,
  rideCount,
  visibleRideCount,
  verifiedSpeedCount,
  unresolvedCappedSpeedCount,
  ridesTruncated,
  onClose,
  onExport,
}: MonthSummaryExportSheetProps) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/18 p-8 backdrop-blur-sm"
      role="presentation"
    >
      <section
        className="ride-export-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="month-summary-export-title"
      >
        <header className="ride-export-header">
          <div>
            <p>导出月度清单</p>
            <h2 id="month-summary-export-title">选择月度导出格式</h2>
            <span>
              {vehicleName} · {formatMonth(month)} · 可选 {visibleRideCount}/{rideCount} 次
            </span>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="关闭月度清单导出"
            disabled={busy}
          >
            <X size={18} />
          </button>
        </header>

        <div className="ride-export-options year-summary-export-options">
          {exportOptions.map((option) => (
            <button
              type="button"
              key={option.format}
              onClick={() => void onExport(option.format)}
              disabled={busy}
            >
              <span>
                {activeFormat === option.format ? (
                  <LoaderCircle size={20} className="animate-spin" />
                ) : (
                  option.icon
                )}
              </span>
              <strong>{option.title}</strong>
              <small>{option.description}</small>
            </button>
          ))}
        </div>

        <div className="month-summary-export-evidence">
          <Gauge size={18} />
          <p>
            极速依据：已用轨迹校验 {verifiedSpeedCount}/{visibleRideCount} 条
            {unresolvedCappedSpeedCount > 0
              ? `；${unresolvedCappedSpeedCount} 条未校验的 25 km/h 旧摘要会保持为空。`
              : "；没有把未验证的旧摘要当作真实极速。"}
          </p>
        </div>

        {ridesTruncated ? (
          <div className="month-summary-export-coverage">
            <TriangleAlert size={18} />
            <p>
              整月总次数、里程、时长、能耗和每日里程是完整汇总；逐次清单仅包含 ninecli 当前返回的{" "}
              {visibleRideCount} 条可选行程。
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="ride-export-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="ride-export-privacy year-summary-export-privacy">
          <ShieldCheck size={18} />
          <p>
            不包含 GPS、轨迹点、车辆 SN 或九号内部行程
            ID；会包含行程时间、每日里程和能耗，仍属于个人出行信息，请谨慎分享。
          </p>
        </div>
      </section>
    </div>
  );
};
