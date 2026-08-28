import { FileJson2, FileSpreadsheet, LoaderCircle, MapPinned, ShieldAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import type { RideDetail, RideExportFormat } from "../../../shared/contracts";

interface RideExportSheetProps {
  open: boolean;
  busy: boolean;
  activeFormat: RideExportFormat | null;
  error: string | null;
  vehicleName: string;
  detail: RideDetail;
  onClose: () => void;
  onExport: (format: RideExportFormat) => Promise<void>;
}

const formatDate = (unixSeconds: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(unixSeconds * 1_000));

const exportOptions = [
  {
    format: "gpx",
    icon: <MapPinned size={20} />,
    title: "GPX 轨迹",
    description: "导入支持 GPX 的地图、运动与轨迹工具",
  },
  {
    format: "csv",
    icon: <FileSpreadsheet size={20} />,
    title: "CSV 表格",
    description: "在 Excel 等表格工具中分析逐点速度、能耗与骑行日里程",
  },
  {
    format: "json",
    icon: <FileJson2 size={20} />,
    title: "JSON 数据",
    description: "保留完整字段，适合备份、编程和 AI 分析",
  },
] as const satisfies ReadonlyArray<{
  format: RideExportFormat;
  icon: ReactNode;
  title: string;
  description: string;
}>;

/** Requires an explicit format choice before opening the native save dialog. */
export const RideExportSheet = ({
  open,
  busy,
  activeFormat,
  error,
  vehicleName,
  detail,
  onClose,
  onExport,
}: RideExportSheetProps) => {
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
        aria-labelledby="ride-export-title"
      >
        <header className="ride-export-header">
          <div>
            <p>导出当前行程</p>
            <h2 id="ride-export-title">选择文件格式</h2>
            <span>
              {vehicleName} · {formatDate(detail.startTime)} · {detail.track.length} 个轨迹点
            </span>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="关闭行程导出"
            disabled={busy}
          >
            <X size={18} />
          </button>
        </header>

        <div className="ride-export-options">
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

        <div className="ride-export-privacy">
          <ShieldAlert size={18} />
          <p>
            导出文件包含精确经纬度、时间、逐点速度、行程能耗和骑行日里程。文件只保存到你在系统窗口中选择的位置，请谨慎分享。
          </p>
        </div>
      </section>
    </div>
  );
};
