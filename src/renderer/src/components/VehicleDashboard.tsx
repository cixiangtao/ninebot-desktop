import {
  Activity,
  ArrowRight,
  BatteryCharging,
  BatteryMedium,
  CircleGauge,
  Clock3,
  Gauge,
  LockKeyhole,
  Power,
  RefreshCw,
  ShieldCheck,
  Thermometer,
  Zap,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { VehicleSnapshot, VehicleSummary } from "../../../shared/contracts";
import type { VehicleSnapshotMonitorEvent } from "../lib/vehicle-monitor";

interface VehicleDashboardProps {
  vehicle: VehicleSummary;
  snapshot: VehicleSnapshot | null;
  live: boolean;
  loading: boolean;
  error: string | null;
  updatedAt: number | null;
  autoRefreshEnabled: boolean;
  monitorEvent: VehicleSnapshotMonitorEvent | null;
  onAutoRefreshChange: () => void;
  onRefresh: () => void;
  onConnect: () => void;
}

const formatValue = (value: number | null, digits = 0) =>
  value === null ? "—" : value.toFixed(digits);

const createRangeEstimate = (label: string, value: number | null) =>
  value === null ? [] : [{ label, value }];

const formatUpdatedAt = (updatedAt: number | null) => {
  if (updatedAt === null) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(updatedAt);
};

const formatMonitorTime = (timestamp: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);

const formatSwitchState = (value: boolean | null | undefined, on: string, off: string) =>
  value === undefined || value === null ? "—" : value ? on : off;

const formatChargeCompletion = (timestamp: number | null | undefined) => {
  if (!timestamp) return null;
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp * 1000);
};

const formatLifecycleDate = (timestamp: number) =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp * 1000);

const BATTERY_READING_DIFFERENCE_WARNING = 5;

/** Presents the location-free subset of ninecli status and battery telemetry. */
export const VehicleDashboard = ({
  vehicle,
  snapshot,
  live,
  loading,
  error,
  updatedAt,
  autoRefreshEnabled,
  monitorEvent,
  onAutoRefreshChange,
  onRefresh,
  onConnect,
}: VehicleDashboardProps) => {
  const batteryPercent = snapshot?.batteryPercent ?? null;
  const displayedBatteryPercent = Math.min(100, Math.max(0, batteryPercent ?? 0));
  const batteryReadingsDiffer =
    snapshot?.statusBatteryPercent !== null &&
    snapshot?.statusBatteryPercent !== undefined &&
    snapshot.diagnosticBatteryPercent !== null &&
    Math.abs(snapshot.statusBatteryPercent - snapshot.diagnosticBatteryPercent) >=
      BATTERY_READING_DIFFERENCE_WARNING;
  const batterySourceText = batteryReadingsDiffer
    ? `诊断 ${formatValue(snapshot.diagnosticBatteryPercent)}% · 状态 ${formatValue(snapshot.statusBatteryPercent)}%`
    : snapshot?.batteryPercentSource === "battery"
      ? "剩余电量 · 电池诊断"
      : snapshot?.batteryPercentSource === "status"
        ? "剩余电量 · 车辆状态回退"
        : "暂无有效电量读数";
  const batterySourceWarning = batteryReadingsDiffer || snapshot?.batteryPercentSource === "status";
  const rangeEstimates = [
    ...createRangeEstimate("智能续航", snapshot?.aiEstimatedRangeKm ?? null),
    ...createRangeEstimate("精细续航", snapshot?.preciseEstimatedRangeKm ?? null),
    ...createRangeEstimate("基础续航", snapshot?.estimatedRangeKm ?? null),
  ];
  const primaryRange = rangeEstimates[0] ?? { label: "预计续航", value: null };
  const batteryPacks = snapshot?.batteryPacks ?? [];
  const batteryScores = batteryPacks.flatMap(({ score }) => (score === null ? [] : [score]));
  const lowestBatteryScore = batteryScores.length > 0 ? Math.min(...batteryScores) : null;
  const batteryCycleTips = [
    ...new Set(batteryPacks.flatMap(({ cycleTip }) => (cycleTip ? [cycleTip] : []))),
  ];
  const chargeCompletion = formatChargeCompletion(snapshot?.chargeCompletionTime);
  const smartServiceText =
    snapshot?.smartServiceExpired === true
      ? "智能服务已到期"
      : vehicle.smartServiceRemainingDays !== null
        ? `智能服务剩余 ${vehicle.smartServiceRemainingDays} 天`
        : null;
  const lifecycleText =
    vehicle.activated === false
      ? "尚未激活"
      : vehicle.access === "shared" && vehicle.authorizationTime !== null
        ? `${formatLifecycleDate(vehicle.authorizationTime)} 获得共享权限`
        : vehicle.activationTime !== null
          ? `${formatLifecycleDate(vehicle.activationTime)} 激活`
          : vehicle.activated === true
            ? "已激活"
            : null;
  const vehicleContext = [
    vehicle.model,
    vehicle.access === "shared" ? "共享车辆" : "自有车辆",
    lifecycleText,
    smartServiceText,
  ]
    .filter((value): value is string => value !== null)
    .join(" · ");
  const unavailableDomains = snapshot
    ? [
        snapshot.availability.status ? null : "车辆状态",
        snapshot.availability.battery ? null : "电池诊断",
      ].filter((domain): domain is string => domain !== null)
    : [];

  return (
    <div className="vehicle-dashboard">
      <header className="vehicle-dashboard-header">
        <div>
          <p className="vehicle-dashboard-eyebrow">设备概览</p>
          <h1>{vehicle.name}</h1>
          <p>{vehicleContext}</p>
        </div>
        <div className="vehicle-dashboard-actions">
          {live ? (
            <button
              className={`vehicle-monitor-toggle ${autoRefreshEnabled ? "vehicle-monitor-toggle-active" : ""}`}
              type="button"
              role="switch"
              aria-checked={autoRefreshEnabled}
              aria-label={autoRefreshEnabled ? "关闭自动状态监看" : "开启自动状态监看"}
              onClick={onAutoRefreshChange}
              disabled={loading}
            >
              <Activity size={15} />
              <span>自动监看</span>
              <i aria-hidden="true">
                <b />
              </i>
            </button>
          ) : null}
          <span className={`vehicle-connection ${live ? "vehicle-connection-live" : ""}`}>
            <i />
            {live ? `九号数据 · ${formatUpdatedAt(updatedAt)}` : "演示数据"}
          </span>
          <button
            className="device-refresh-button"
            type="button"
            onClick={live ? onRefresh : onConnect}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            {live ? "刷新状态" : "连接账号"}
          </button>
        </div>
      </header>

      {live && (autoRefreshEnabled || monitorEvent) ? (
        <section className="vehicle-monitor-strip" aria-live="polite">
          <div className="vehicle-monitor-heading">
            <Activity size={16} />
            <span>
              <strong>{autoRefreshEnabled ? "状态监看中" : "最近一次刷新"}</strong>
              <small>
                {autoRefreshEnabled
                  ? "每 60 秒刷新；离开设备页或隐藏窗口时暂停"
                  : monitorEvent
                    ? `${formatMonitorTime(monitorEvent.observedAt)} ${monitorEvent.source === "automatic" ? "自动读取" : "手动读取"}`
                    : "等待刷新"}
              </small>
            </span>
          </div>
          {monitorEvent ? (
            !monitorEvent.hasComparison ? (
              <span className="vehicle-monitor-stable">已建立第一份对照状态，等待下一次刷新</span>
            ) : monitorEvent.changes.length > 0 ? (
              <ul className="vehicle-monitor-changes" aria-label="车辆状态变化">
                {monitorEvent.changes.slice(0, 4).map((change) => (
                  <li key={change.id}>
                    <small>{change.label}</small>
                    <span>{change.previousValue}</span>
                    <ArrowRight size={12} />
                    <strong>{change.currentValue}</strong>
                  </li>
                ))}
                {monitorEvent.changes.length > 4 ? (
                  <li className="vehicle-monitor-more">
                    另有 {monitorEvent.changes.length - 4} 项
                  </li>
                ) : null}
              </ul>
            ) : (
              <span className="vehicle-monitor-stable">
                {monitorEvent.source === "automatic" ? "刚刚自动刷新" : "刚刚手动刷新"}
                ，状态未发生变化
              </span>
            )
          ) : (
            <span className="vehicle-monitor-stable">已开启，正在读取第一份对照状态</span>
          )}
        </section>
      ) : null}

      {error ? (
        <div className="vehicle-dashboard-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onRefresh} disabled={loading}>
            重新读取
          </button>
        </div>
      ) : null}

      {unavailableDomains.length > 0 ? (
        <div className="vehicle-dashboard-partial" role="status">
          <span>
            已显示当前可用数据；{unavailableDomains.join("、")}暂时不可用，缺失项保持为 —。
          </span>
          <button type="button" onClick={onRefresh} disabled={loading}>
            重新读取
          </button>
        </div>
      ) : null}

      <div className="vehicle-dashboard-grid">
        <article className="vehicle-energy-card">
          <div className="device-card-heading">
            <div>
              <span>当前能量</span>
              <strong>{snapshot?.charging ? "正在充电" : "电池状态"}</strong>
            </div>
            {snapshot?.charging ? <BatteryCharging size={21} /> : <BatteryMedium size={21} />}
          </div>

          <div className="battery-orbit-wrap">
            <div
              className="battery-orbit"
              style={{ "--battery-level": `${displayedBatteryPercent}%` } as CSSProperties}
              aria-label={`剩余电量 ${formatValue(batteryPercent)}%，${batterySourceText}`}
            >
              <div>
                <strong>{formatValue(batteryPercent)}</strong>
                <span>%</span>
                <small
                  className={batterySourceWarning ? "battery-orbit-source-warning" : undefined}
                  title={
                    batteryReadingsDiffer
                      ? "两个只读接口返回的电量相差至少 5 个百分点，当前优先采用电池诊断读数。"
                      : undefined
                  }
                >
                  {batterySourceText}
                </small>
              </div>
            </div>
          </div>

          <div className="vehicle-energy-summary">
            <DeviceMetric
              icon={<Gauge size={17} />}
              label={primaryRange.label}
              value={formatValue(primaryRange.value, 1)}
              unit="km"
            />
            <DeviceMetric
              icon={<ShieldCheck size={17} />}
              label={batteryPacks.length > 1 ? "最低评分" : "电池评分"}
              value={formatValue(lowestBatteryScore)}
              unit="分"
            />
          </div>

          {rangeEstimates.length > 1 ? (
            <div className="vehicle-range-comparison" aria-label="续航估算对比">
              <span>算法估算</span>
              <div>
                {rangeEstimates.map((estimate) => (
                  <p key={estimate.label}>
                    <small>{estimate.label}</small>
                    <strong>{estimate.value.toFixed(1)} km</strong>
                  </p>
                ))}
              </div>
            </div>
          ) : null}

          {snapshot?.charging && (snapshot.remainingChargeTimeText || chargeCompletion) ? (
            <div className="vehicle-charge-remaining" role="status">
              <Clock3 size={16} />
              <span>
                {snapshot.remainingChargeTimeText
                  ? `预计充满还需 ${snapshot.remainingChargeTimeText}`
                  : `预计 ${chargeCompletion} 充满`}
                {snapshot.remainingChargeTimeText && chargeCompletion
                  ? ` · ${chargeCompletion} 完成`
                  : ""}
              </span>
            </div>
          ) : null}
        </article>

        <div className="vehicle-dashboard-stack">
          <article className="device-status-card">
            <div className="device-section-title">
              <div>
                <span>车辆状态</span>
                <strong>只读实时信息</strong>
              </div>
              <CircleGauge size={20} />
            </div>
            <div className="device-state-grid">
              <StateTile
                icon={<LockKeyhole size={19} />}
                label="车辆锁"
                value={formatSwitchState(snapshot?.locked, "已锁定", "未锁定")}
                good={snapshot?.locked === true}
              />
              <StateTile
                icon={<Power size={19} />}
                label="主电源"
                value={formatSwitchState(snapshot?.poweredOn, "已接通", "未接通")}
                good={snapshot?.poweredOn === false}
              />
              <StateTile
                icon={<Gauge size={19} />}
                label="ACC 状态"
                value={formatSwitchState(snapshot?.ignitionOn, "已开启", "已关闭")}
                good={snapshot?.ignitionOn === false}
              />
              <StateTile
                icon={<Zap size={19} />}
                label="充电状态"
                value={formatSwitchState(snapshot?.charging, "充电中", "未充电")}
                good={snapshot?.charging === true}
              />
            </div>
          </article>

          <article className="battery-detail-card">
            <div className="device-section-title">
              <div>
                <span>电池明细</span>
                <strong>
                  {snapshot
                    ? `${snapshot.batteryPacks.length} 组${snapshot.batteryChemistry === "lithium" ? "锂电池" : "电池"}数据`
                    : "等待同步"}
                </strong>
              </div>
              <BatteryCharging size={20} />
            </div>
            {batteryPacks.length > 0 ? (
              <div className="battery-pack-list">
                {batteryPacks.map((pack, index) => (
                  <section
                    className="battery-pack-card"
                    key={pack.id}
                    aria-label={`第 ${index + 1} 组电池`}
                  >
                    <div className="battery-pack-heading">
                      <strong>电池 {index + 1}</strong>
                      <span>
                        {formatValue(pack.electricityPercent)}% · {formatValue(pack.score)} 分
                      </span>
                    </div>
                    <div className="battery-detail-grid">
                      <BatteryDatum
                        icon={<Thermometer size={16} />}
                        label="温度"
                        value={formatValue(pack.temperatureC)}
                        unit="°C"
                      />
                      <BatteryDatum
                        icon={<Zap size={16} />}
                        label="电压"
                        value={formatValue(pack.voltageV, 1)}
                        unit="V"
                      />
                      <BatteryDatum
                        icon={<RefreshCw size={16} />}
                        label="循环次数"
                        value={formatValue(pack.cycleCount)}
                        unit="次"
                      />
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <p className="battery-detail-empty">
                {loading
                  ? "正在读取电池管理系统数据…"
                  : snapshot && !snapshot.availability.battery
                    ? "电池诊断服务暂时不可用，请刷新重试。"
                    : "暂无可展示的电池包数据。"}
              </p>
            )}
            {batteryCycleTips.length > 0 ? (
              <div className="battery-cycle-tips" aria-label="电池循环次数说明">
                {batteryCycleTips.map((tip) => (
                  <p key={tip}>{tip}</p>
                ))}
              </div>
            ) : null}
          </article>
        </div>
      </div>

      <p className="vehicle-dashboard-boundary">
        此页面只读取 ninecli 的 status 与 battery 数据；车辆 SN、实时坐标和控制能力不会传给页面。
      </p>
    </div>
  );
};

interface DeviceMetricProps {
  icon: ReactNode;
  label: string;
  value: string;
  unit: string;
}

const DeviceMetric = ({ icon, label, value, unit }: DeviceMetricProps) => (
  <div className="device-metric">
    <span className="device-metric-icon">{icon}</span>
    <span>
      <small>{label}</small>
      <strong>
        {value} <i>{unit}</i>
      </strong>
    </span>
  </div>
);

interface StateTileProps {
  icon: ReactNode;
  label: string;
  value: string;
  good: boolean;
}

const StateTile = ({ icon, label, value, good }: StateTileProps) => (
  <div className="device-state-tile">
    <span className={good ? "device-state-icon-good" : ""}>{icon}</span>
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  </div>
);

interface BatteryDatumProps {
  icon: ReactNode;
  label: string;
  value: string;
  unit: string;
}

const BatteryDatum = ({ icon, label, value, unit }: BatteryDatumProps) => (
  <div className="battery-datum">
    <span>{icon}</span>
    <small>{label}</small>
    <strong>
      {value} <i>{unit}</i>
    </strong>
  </div>
);
