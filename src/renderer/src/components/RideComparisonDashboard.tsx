import { ArrowLeft, LoaderCircle, RefreshCw } from "lucide-react";
import type { CSSProperties } from "react";
import type { RideDetail, RideSummary, VehicleSummary } from "../../../shared/contracts";
import {
  createRideComparisonMetrics,
  formatSignedDecimal,
  formatSignedDuration,
  type RideComparisonMetric,
} from "../lib/comparison";
import { formatLongDuration, formatMonth, formatRideDate } from "../lib/format";
import { summarizeTrackSpeedZones } from "../lib/track";

interface RideComparisonDashboardProps {
  vehicle: VehicleSummary;
  month: string;
  base: RideDetail;
  comparison: RideDetail | null;
  candidates: RideSummary[];
  selectedRideId: string | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onSelect: (ride: RideSummary) => void;
  onRetry: () => void;
}

const formatMetricValue = (metric: RideComparisonMetric, value: number | null) => {
  if (value === null) return "—";
  return metric.unit === "time" ? formatLongDuration(value) : value.toFixed(metric.precision);
};

const formatMetricDelta = (metric: RideComparisonMetric) => {
  if (metric.delta === null) return "—";
  return metric.unit === "time"
    ? formatSignedDuration(metric.delta)
    : `${formatSignedDecimal(metric.delta, metric.precision)} ${metric.unit}`;
};

/** Compares two same-month ride details without ranking different ride contexts. */
export const RideComparisonDashboard = ({
  vehicle,
  month,
  base,
  comparison,
  candidates,
  selectedRideId,
  loading,
  error,
  onBack,
  onSelect,
  onRetry,
}: RideComparisonDashboardProps) => {
  const metrics = comparison ? createRideComparisonMetrics(base, comparison) : [];
  const baseZones = summarizeTrackSpeedZones(base.track);
  const comparisonZones = summarizeTrackSpeedZones(comparison?.track ?? []);

  return (
    <div className="ride-comparison-dashboard">
      <header className="ride-comparison-header">
        <button className="ride-comparison-back" type="button" onClick={onBack}>
          <ArrowLeft size={16} />
          返回轨迹
        </button>
        <div>
          <h1>比较两次骑行</h1>
          <p>
            {vehicle.name} · {formatMonth(month)} · 差值为“对比行程 − 当前行程”
          </p>
        </div>
      </header>

      <section className="ride-comparison-picker" aria-label="选择对比行程">
        <div>
          <span>当前行程</span>
          <strong>{formatRideDate(base.startTime)}</strong>
          <small>{base.mileageKm.toFixed(1)} km</small>
        </div>
        <label>
          <span>对比行程</span>
          <select
            value={selectedRideId ?? ""}
            disabled={loading || candidates.length === 0}
            onChange={(event) => {
              const selectedRide = candidates.find(({ id }) => id === event.target.value);
              if (selectedRide) onSelect(selectedRide);
            }}
          >
            {candidates.map((ride) => (
              <option key={ride.id} value={ride.id}>
                {formatRideDate(ride.startTime)} · {ride.mileageKm.toFixed(1)} km
              </option>
            ))}
          </select>
        </label>
      </section>

      {loading ? (
        <div className="ride-comparison-state" role="status">
          <LoaderCircle size={18} className="animate-spin" />
          正在读取对比行程的轨迹详情
        </div>
      ) : null}

      {error ? (
        <div className="ride-comparison-state ride-comparison-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onRetry}>
            <RefreshCw size={14} />
            重试
          </button>
        </div>
      ) : null}

      {comparison ? (
        <>
          <section className="ride-comparison-metrics" aria-label="行程指标对比">
            <div className="ride-comparison-table-header" aria-hidden="true">
              <span>指标</span>
              <span>当前行程</span>
              <span>对比行程</span>
              <span>差值</span>
            </div>
            {metrics.map((metric) => (
              <div className="ride-comparison-metric-row" key={metric.key}>
                <strong>{metric.label}</strong>
                <span>
                  {formatMetricValue(metric, metric.baseValue)}
                  {metric.unit !== "time" ? <small>{metric.unit}</small> : null}
                </span>
                <span>
                  {formatMetricValue(metric, metric.comparisonValue)}
                  {metric.unit !== "time" ? <small>{metric.unit}</small> : null}
                </span>
                <i>{formatMetricDelta(metric)}</i>
              </div>
            ))}
          </section>

          <section className="ride-comparison-zones" aria-label="速度区间对比">
            <header>
              <div>
                <strong>轨迹里程占比</strong>
                <span>按相邻 GPS 轨迹点间的距离计算</span>
              </div>
              <small>当前行程 / 对比行程</small>
            </header>
            <div className="ride-comparison-zone-heading" aria-hidden="true">
              <span>速度</span>
              <span>当前行程</span>
              <span>对比行程</span>
            </div>
            {baseZones.map((zone, index) => {
              const otherZone = comparisonZones[index];
              const basePercentage = Math.round(zone.distanceShare * 100);
              const comparisonPercentage = Math.round((otherZone?.distanceShare ?? 0) * 100);
              return (
                <div className="ride-comparison-zone-row" key={zone.label}>
                  <strong>
                    <i style={{ background: zone.color }} />
                    {zone.label}
                    <small>km/h</small>
                  </strong>
                  <ZoneBar percentage={basePercentage} color={zone.color} />
                  <ZoneBar percentage={comparisonPercentage} color={zone.color} />
                </div>
              );
            })}
          </section>

          <p className="ride-comparison-boundary">
            对比只呈现数据差异，不判断哪次骑行更好；路线、路况、载重和采样密度都可能影响结果。历史摘要若固定为
            25 km/h，极速仍优先采用详情轨迹的实测峰值。
          </p>
        </>
      ) : null}
    </div>
  );
};

interface ZoneBarProps {
  percentage: number;
  color: string;
}

const ZoneBar = ({ percentage, color }: ZoneBarProps) => (
  <div className="ride-comparison-zone-bar" aria-label={`${percentage}%`}>
    <span>
      <i
        style={
          {
            "--zone-width": `${percentage}%`,
            "--zone-color": color,
          } as CSSProperties
        }
      />
    </span>
    <strong>{percentage}%</strong>
  </div>
);
