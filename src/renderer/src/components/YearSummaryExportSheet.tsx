import { FileJson2, FileSpreadsheet, LoaderCircle, ShieldCheck, X } from "lucide-react";
import type { ReactNode } from "react";
import type { YearSummaryExportFormat } from "../../../shared/contracts";

interface YearSummaryExportSheetProps {
  open: boolean;
  busy: boolean;
  activeFormat: YearSummaryExportFormat | null;
  error: string | null;
  vehicleName: string;
  year: number;
  monthCount: number;
  onClose: () => void;
  onExport: (format: YearSummaryExportFormat) => Promise<void>;
}

const exportOptions = [
  {
    format: "csv",
    icon: <FileSpreadsheet size={20} />,
    title: "CSV 表格",
    description: "包含年度总量与平均值、月度汇总和每日里程，适合 Excel 分析",
  },
  {
    format: "json",
    icon: <FileJson2 size={20} />,
    title: "JSON 数据",
    description: "保留年/月层级、平均值与覆盖情况，适合编程和 AI 分析",
  },
] as const satisfies ReadonlyArray<{
  format: YearSummaryExportFormat;
  icon: ReactNode;
  title: string;
  description: string;
}>;

/** Explains the deliberately reduced annual export before opening the native save dialog. */
export const YearSummaryExportSheet = ({
  open,
  busy,
  activeFormat,
  error,
  vehicleName,
  year,
  monthCount,
  onClose,
  onExport,
}: YearSummaryExportSheetProps) => {
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
        aria-labelledby="year-summary-export-title"
      >
        <header className="ride-export-header">
          <div>
            <p>导出年度摘要</p>
            <h2 id="year-summary-export-title">选择年度导出格式</h2>
            <span>
              {vehicleName} · {year} 年 · 已读取 {monthCount} 个月
            </span>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="关闭年度摘要导出"
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

        {error ? (
          <p className="ride-export-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="ride-export-privacy year-summary-export-privacy">
          <ShieldCheck size={18} />
          <p>
            仅导出年度总量与平均值、月度汇总、每日里程和数据完整性标记；不包含 GPS
            坐标、轨迹点、车辆 SN 或九号内部行程 ID。每日出行规律仍属于个人信息，请谨慎分享。
          </p>
        </div>
      </section>
    </div>
  );
};
