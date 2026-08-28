import { MapPinned } from "lucide-react";
import type { CoordinateDisplayMode } from "../lib/coordinate";

interface CoordinatePreviewControlProps {
  mode: CoordinateDisplayMode;
  shiftMeters: number;
  surface: "route" | "location";
  onChange: (mode: CoordinateDisplayMode) => void;
}

const formatShift = (shiftMeters: number) => {
  const roundedMeters = Math.max(0, Math.round(shiftMeters / 10) * 10);
  return roundedMeters < 1_000
    ? `约 ${roundedMeters} m`
    : `约 ${(roundedMeters / 1_000).toFixed(1)} km`;
};

/** Toggles a map-only GCJ-02 to WGS84 hypothesis without changing source coordinates. */
export const CoordinatePreviewControl = ({
  mode,
  shiftMeters,
  surface,
  onChange,
}: CoordinatePreviewControlProps) => {
  const previewActive = mode === "gcj02-to-wgs84-preview";
  const nextMode = previewActive ? "source" : "gcj02-to-wgs84-preview";
  const shiftText = formatShift(shiftMeters);

  return (
    <button
      className={`coordinate-preview-control coordinate-preview-control-${surface} ${previewActive ? "coordinate-preview-control-active" : ""}`}
      type="button"
      aria-label={
        previewActive ? "关闭坐标校准预览并恢复接口原值" : "启用GCJ-02转WGS84坐标校准预览"
      }
      aria-pressed={previewActive}
      data-coordinate-mode={mode}
      data-shift-meters={Math.round(shiftMeters)}
      title={
        previewActive
          ? "正在本地预览 GCJ-02→WGS84；点击恢复接口原值。原始轨迹、统计和导出未修改。"
          : `尝试在本地按 GCJ-02→WGS84 移动地图覆盖物（${shiftText}）；原始轨迹、统计和导出不会修改。`
      }
      onClick={() => onChange(nextMode)}
    >
      <MapPinned size={15} />
      <span>{previewActive ? `校准预览 · ${shiftText}` : "坐标 · 接口原值"}</span>
    </button>
  );
};
