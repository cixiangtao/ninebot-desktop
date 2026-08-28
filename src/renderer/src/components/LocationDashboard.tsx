import {
  EyeOff,
  Globe2,
  LoaderCircle,
  LockKeyhole,
  MapPinned,
  Power,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  VehicleLocation,
  VehicleLocationPermission,
  VehicleSummary,
} from "../../../shared/contracts";
import type { CoordinateDisplayMode } from "../lib/coordinate";
import { VehicleLocationMap } from "./VehicleLocationMap";

interface LocationDashboardProps {
  vehicle: VehicleSummary;
  location: VehicleLocation | null;
  permission: VehicleLocationPermission;
  authorized: boolean;
  live: boolean;
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
  coordinateDisplayMode: CoordinateDisplayMode;
  onAuthorize: () => void;
  onRefresh: () => void;
  onClear: () => void;
  onCoordinateDisplayModeChange: (mode: CoordinateDisplayMode) => void;
}

const formatUpdatedAt = (updatedAt: number | null) => {
  if (updatedAt === null) return "尚未读取";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(updatedAt);
};

/** Gates all location and third-party tile requests behind an explicit user action. */
export const LocationDashboard = ({
  vehicle,
  location,
  permission,
  authorized,
  live,
  loading,
  error,
  updatedAt,
  coordinateDisplayMode,
  onAuthorize,
  onRefresh,
  onClear,
  onCoordinateDisplayModeChange,
}: LocationDashboardProps) => {
  if (!authorized) {
    return (
      <div className="location-consent-page">
        <section className="location-consent-card">
          <span className="location-consent-icon">
            <MapPinned size={28} />
          </span>
          <p>车辆位置</p>
          <h1>按需显示，不在后台追踪</h1>
          <span className="location-consent-description">
            设备状态查询的 ninecli status 响应可能包含位置，但授权前坐标不会交给页面。确认后才会把
            {vehicle.name} 的新读取位置传给页面，并按该区域请求 OpenFreeMap 地图瓦片。
          </span>

          <div className="location-consent-boundaries">
            <LocationBoundary
              icon={<ShieldAlert size={18} />}
              title="地图服务能推断大致区域"
              detail="坐标不会作为自定义参数上传，但瓦片请求本身会暴露当前视野。"
            />
            <LocationBoundary
              icon={<EyeOff size={18} />}
              title="SN、令牌和 status 原文不会离开主进程"
              detail="授权前主进程丢弃坐标；授权后页面只接收坐标、锁车和 ACC 状态。"
            />
            <LocationBoundary
              icon={<Globe2 size={18} />}
              title="坐标基准可在地图中对照"
              detail="默认使用接口原值；显示后可本地预览 GCJ-02→WGS84，不修改原始数据。"
            />
          </div>

          {error ? <p className="location-consent-error">{error}</p> : null}
          <button
            className="location-authorize-button"
            type="button"
            onClick={onAuthorize}
            disabled={loading}
          >
            {loading ? (
              <LoaderCircle size={17} className="animate-spin" />
            ) : (
              <MapPinned size={17} />
            )}
            {live ? "读取并显示车辆位置" : "查看演示位置"}
          </button>
          <small>本次授权仅保留在当前应用会话和当前车辆中。</small>
        </section>
      </div>
    );
  }

  return (
    <div className="location-dashboard">
      {location ? (
        <VehicleLocationMap
          location={location}
          coordinateDisplayMode={coordinateDisplayMode}
          onCoordinateDisplayModeChange={onCoordinateDisplayModeChange}
        />
      ) : (
        <div className="location-map-empty" />
      )}
      <section className="location-status-panel">
        <div className="location-status-heading">
          <div>
            <p>车辆位置</p>
            <h1>{vehicle.name}</h1>
            <span>
              {vehicle.model} · {vehicle.access === "shared" ? "共享车辆" : "自有车辆"}
            </span>
          </div>
          <button type="button" onClick={onClear} aria-label="停止显示车辆位置">
            <EyeOff size={17} />
          </button>
        </div>

        {loading ? (
          <div className="location-reading" role="status">
            <LoaderCircle size={16} className="animate-spin" />
            正在读取九号车辆位置…
          </div>
        ) : permission === "denied" ? (
          <div className="location-reading location-reading-permission" role="status">
            <ShieldAlert size={17} />
            <span>
              <strong>共享权限不包含车辆位置</strong>
              <small>请让车主在九号出行中调整共享权限，然后重新检查。</small>
            </span>
          </div>
        ) : error ? (
          <div className="location-reading location-reading-error" role="alert">
            {error}
          </div>
        ) : location ? (
          <div className="location-state-grid">
            <LocationState
              icon={<LockKeyhole size={17} />}
              label="车辆锁"
              value={location.locked ? "已锁定" : "未锁定"}
            />
            <LocationState
              icon={<Power size={17} />}
              label="ACC 状态"
              value={location.ignitionOn ? "已开启" : "已关闭"}
            />
          </div>
        ) : (
          <div className="location-reading location-reading-error">九号服务没有返回有效位置。</div>
        )}

        <div className="location-status-footer">
          <span>更新于 {formatUpdatedAt(updatedAt)}</span>
          <button type="button" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {permission === "denied" ? "重新检查权限" : "刷新位置"}
          </button>
        </div>
      </section>
    </div>
  );
};

interface LocationBoundaryProps {
  icon: ReactNode;
  title: string;
  detail: string;
}

const LocationBoundary = ({ icon, title, detail }: LocationBoundaryProps) => (
  <div className="location-boundary-row">
    <span>{icon}</span>
    <div>
      <strong>{title}</strong>
      <small>{detail}</small>
    </div>
  </div>
);

interface LocationStateProps {
  icon: ReactNode;
  label: string;
  value: string;
}

const LocationState = ({ icon, label, value }: LocationStateProps) => (
  <div className="location-state">
    <span>{icon}</span>
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  </div>
);
