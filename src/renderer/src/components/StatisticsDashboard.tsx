import {
  Activity,
  BatteryCharging,
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Gauge,
  RefreshCw,
  Route,
} from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";
import type { VehicleSummary, YearSummaryExportMonth } from "../../../shared/contracts";
import {
  getMonthTrendValue,
  type MonthRideStatistics,
  type StatisticsTrendMetric,
  type YearRideStatistics,
} from "../lib/statistics";
import { formatHistoryStartDate, getMonthFromUnixSeconds } from "../lib/format";
import { YearActivityHeatmap } from "./YearActivityHeatmap";

interface StatisticsDashboardProps {
  vehicle: VehicleSummary;
  statistics: YearRideStatistics | null;
  rollingMonths: MonthRideStatistics[];
  year: number;
  currentMonth: string;
  historyStartTime: number | null;
  live: boolean;
  loading: boolean;
  progress: { loaded: number; total: number };
  error: string | null;
  exportNotice: string | null;
  activityMonths: YearSummaryExportMonth[];
  onPreviousYear: () => void;
  onNextYear: () => void;
  onRefresh: () => void;
  onExport: () => void;
  onSelectMonth: (month: string) => void;
  exportDisabled: boolean;
  onConnect: () => void;
}

const formatHours = (seconds: number) => (seconds / 3600).toFixed(1);

const trendMetrics = [
  { id: "mileage", label: "里程", unit: "km", title: "月度里程" },
  { id: "rides", label: "次数", unit: "次", title: "月度次数" },
  { id: "averageRide", label: "单次均里程", unit: "km", title: "月度平均单次里程" },
  { id: "energy", label: "能耗", unit: "kWh", title: "月度能耗" },
  { id: "activeDays", label: "活跃天", unit: "天", title: "月度活跃天数" },
  { id: "efficiency", label: "平均能耗", unit: "Wh/km", title: "月度平均能耗" },
] as const satisfies readonly {
  id: StatisticsTrendMetric;
  label: string;
  unit: string;
  title: string;
}[];

const formatTrendValue = (value: number, metric: StatisticsTrendMetric) => {
  if (metric === "energy") return (value / 1_000).toFixed(2);
  if (metric === "mileage" || metric === "averageRide" || metric === "efficiency") {
    return value.toFixed(1);
  }
  return value.toFixed(0);
};

type StatisticsTrendRange = "calendar" | "rolling";

const formatTrendMonthName = (month: string) => `${month.slice(0, 4)}年${Number(month.slice(4))}月`;

/** Presents on-demand yearly summaries built from monthly ninecli travel lists. */
export const StatisticsDashboard = ({
  vehicle,
  statistics,
  rollingMonths,
  year,
  currentMonth,
  historyStartTime,
  live,
  loading,
  progress,
  error,
  exportNotice,
  activityMonths,
  onPreviousYear,
  onNextYear,
  onRefresh,
  onExport,
  onSelectMonth,
  exportDisabled,
  onConnect,
}: StatisticsDashboardProps) => {
  const [trendMetric, setTrendMetric] = useState<StatisticsTrendMetric>("mileage");
  const [trendRange, setTrendRange] = useState<StatisticsTrendRange>("calendar");
  const currentYear = Number(currentMonth.slice(0, 4));
  const historyStartMonth =
    historyStartTime === null ? null : getMonthFromUnixSeconds(historyStartTime);
  const minimumYear = historyStartMonth === null ? null : Number(historyStartMonth.slice(0, 4));
  const activeTrend = trendMetrics.find(({ id }) => id === trendMetric) ?? trendMetrics[0];
  const rollingAvailable = year === currentYear && rollingMonths.length === 12;
  const rollingSelected = trendRange === "rolling" && rollingAvailable;
  const trendMonths = rollingSelected ? rollingMonths : (statistics?.months ?? []);
  const trendValues = trendMonths.map((month) => getMonthTrendValue(month, trendMetric));
  const maximumTrendValue = Math.max(1, ...trendValues.map((value) => value ?? 0));
  const aggregateIncomplete = (statistics?.aggregateUnavailableMonthCount ?? 0) > 0;
  const truncatedRideMonthCount = statistics?.truncatedRideMonthCount ?? 0;
  const prefix = aggregateIncomplete ? "至少 " : "";

  return (
    <div className="statistics-dashboard">
      <header className="statistics-header">
        <div>
          <p>骑行统计</p>
          <h1>{vehicle.name}</h1>
          <span>
            {vehicle.model} · {vehicle.access === "shared" ? "共享车辆" : "自有车辆"} ·
            按月读取，不加载 GPS 轨迹
            {historyStartTime === null
              ? ""
              : ` · 数据从 ${formatHistoryStartDate(historyStartTime)} 开始`}
          </span>
        </div>
        <div className="statistics-actions">
          <div className="statistics-year-switcher" aria-label="统计年份">
            <button
              type="button"
              onClick={onPreviousYear}
              aria-label="上一统计年份"
              disabled={minimumYear !== null && year <= minimumYear}
            >
              <ChevronLeft size={16} />
            </button>
            <strong>{year}年</strong>
            <button
              type="button"
              onClick={onNextYear}
              aria-label="下一统计年份"
              disabled={year >= currentYear}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <button
            className="statistics-refresh"
            type="button"
            onClick={live ? onRefresh : onConnect}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            {live ? "重新统计" : "连接账号"}
          </button>
          <button
            className="statistics-refresh"
            type="button"
            onClick={onExport}
            disabled={exportDisabled}
          >
            <Download size={15} />
            导出摘要
          </button>
        </div>
      </header>

      {loading ? (
        <div className="statistics-progress" role="status">
          <span>
            {year === currentYear ? "正在读取年度与近 12 个月记录" : `正在读取 ${year} 年月度记录`}
            {` · ${progress.loaded}/${progress.total}`}
          </span>
          <i
            style={
              {
                "--statistics-progress": `${progress.total > 0 ? (progress.loaded / progress.total) * 100 : 0}%`,
              } as CSSProperties
            }
          />
        </div>
      ) : null}

      {error ? (
        <div className="statistics-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={onRefresh}>
            重试
          </button>
        </div>
      ) : null}

      {exportNotice ? (
        <p className="statistics-export-notice" role="status">
          {exportNotice}
        </p>
      ) : null}

      <section className="statistics-summary-grid" aria-label={`${year}年汇总`}>
        <SummaryCard
          icon={<Route size={19} />}
          label="骑行里程"
          value={`${prefix}${(statistics?.mileageKm ?? 0).toFixed(1)}`}
          unit="km"
        />
        <SummaryCard
          icon={<Activity size={19} />}
          label="骑行次数"
          value={`${prefix}${statistics?.rideCount ?? 0}`}
          unit="次"
        />
        <SummaryCard
          icon={<Clock3 size={19} />}
          label="骑行时长"
          value={`${prefix}${formatHours(statistics?.durationSeconds ?? 0)}`}
          unit="小时"
        />
        <SummaryCard
          icon={<BatteryCharging size={19} />}
          label="骑行能耗"
          value={
            statistics?.energyWh === null || statistics?.energyWh === undefined
              ? "—"
              : `${prefix}${(statistics.energyWh / 1000).toFixed(1)}`
          }
          unit="kWh"
        />
        <SummaryCard
          icon={<CalendarCheck2 size={19} />}
          label="活跃天数"
          value={statistics?.activeDayCount?.toString() ?? "—"}
          unit="天"
        />
        <SummaryCard
          icon={<Gauge size={19} />}
          label="平均能耗"
          value={statistics?.averageEnergyWhPerKm?.toFixed(1) ?? "—"}
          unit="Wh/km"
        />
      </section>

      <YearActivityHeatmap
        year={year}
        months={activityMonths}
        historyStartTime={historyStartTime}
        loading={loading}
        onSelectMonth={onSelectMonth}
      />

      <section className="statistics-chart-card">
        <div className="statistics-section-heading">
          <div>
            <strong>
              {rollingSelected ? "近 12 个月 · " : `${year} 年 · `}
              {activeTrend.title}趋势
            </strong>
          </div>
          <small>
            {rollingSelected && trendMonths[0]
              ? `${formatTrendMonthName(trendMonths[0].month)}–${formatTrendMonthName(trendMonths.at(-1)?.month ?? trendMonths[0].month)}`
              : "点击月份进入行程列表"}
            {` · 单位：${activeTrend.unit}`}
          </small>
        </div>
        <div className="statistics-trend-toolbar">
          <div className="statistics-trend-controls" aria-label="选择月度趋势指标">
            {trendMetrics.map((metric) => (
              <button
                key={metric.id}
                type="button"
                aria-pressed={trendMetric === metric.id}
                onClick={() => setTrendMetric(metric.id)}
              >
                {metric.label}
              </button>
            ))}
          </div>
          {year === currentYear ? (
            <div className="statistics-trend-range-controls" aria-label="选择趋势时间范围">
              <button
                type="button"
                aria-pressed={!rollingSelected}
                onClick={() => setTrendRange("calendar")}
              >
                自然年
              </button>
              <button
                type="button"
                aria-pressed={rollingSelected}
                disabled={!rollingAvailable}
                onClick={() => setTrendRange("rolling")}
              >
                近12月
              </button>
            </div>
          ) : null}
        </div>
        <div
          className="statistics-bars"
          aria-label={`${rollingSelected ? "近12个月" : `${year}年`}${activeTrend.title}图`}
        >
          {trendMonths.map((month) => {
            const future = month.month > currentMonth;
            const beforeHistory = historyStartMonth !== null && month.month < historyStartMonth;
            const monthName = formatTrendMonthName(month.month);
            const trendValue = getMonthTrendValue(month, trendMetric);
            const formattedTrendValue =
              trendValue === null ? null : formatTrendValue(trendValue, trendMetric);
            const height =
              !beforeHistory && trendValue !== null && trendValue > 0
                ? Math.max(6, (trendValue / maximumTrendValue) * 100)
                : 2;
            return (
              <button
                type="button"
                className={`statistics-bar-column ${future || beforeHistory ? "statistics-bar-future" : ""} ${trendValue === null ? "statistics-bar-unavailable" : ""}`}
                key={month.month}
                disabled={future || beforeHistory}
                onClick={() => onSelectMonth(month.month)}
                aria-label={
                  beforeHistory
                    ? `${monthName}，车辆数据起点之前`
                    : future
                      ? `${monthName}，尚未发生`
                      : formattedTrendValue === null
                        ? `${monthName}，${activeTrend.title}不可用`
                        : `${monthName}，${formattedTrendValue} ${activeTrend.unit}，查看行程`
                }
                title={
                  beforeHistory
                    ? `${monthName}：车辆数据起点之前`
                    : formattedTrendValue === null
                      ? `${monthName}：${activeTrend.title}不可用`
                      : `${monthName}：${formattedTrendValue} ${activeTrend.unit}`
                }
              >
                <span>
                  {!beforeHistory && trendValue !== null && trendValue > 0
                    ? formattedTrendValue
                    : ""}
                </span>
                <i style={{ "--bar-height": `${height}%` } as CSSProperties} />
                <small>
                  {rollingSelected
                    ? `${month.month.slice(2, 4)}/${Number(month.month.slice(4))}`
                    : `${Number(month.month.slice(4))}月`}
                </small>
              </button>
            );
          })}
        </div>
      </section>

      <section className="statistics-month-card">
        <div className="statistics-section-heading">
          <div>
            <span>月度明细</span>
            <strong>当前可读取记录</strong>
          </div>
          <small>
            {aggregateIncomplete
              ? "部分月份仅有可见明细"
              : truncatedRideMonthCount > 0
                ? `${truncatedRideMonthCount} 个月的可选明细被截断`
                : "整月汇总与明细均完整"}
          </small>
        </div>
        <div className="statistics-month-grid">
          {(statistics?.months ?? []).map((month) => {
            const future = month.month > currentMonth;
            const beforeHistory = historyStartMonth !== null && month.month < historyStartMonth;
            return (
              <button
                type="button"
                className={`statistics-month-row ${future || beforeHistory ? "statistics-month-future" : ""}`}
                key={month.month}
                disabled={future || beforeHistory}
                onClick={() => onSelectMonth(month.month)}
                aria-label={
                  beforeHistory
                    ? `${Number(month.month.slice(4))}月，数据起点前`
                    : future
                      ? `${Number(month.month.slice(4))}月，尚未发生`
                      : `${Number(month.month.slice(4))}月，${month.rideCount}次，${month.mileageKm.toFixed(1)}公里，查看行程`
                }
              >
                <strong>{Number(month.month.slice(4))}月</strong>
                <span>
                  {beforeHistory ? "数据起点前" : future ? "尚未发生" : `${month.rideCount} 次`}
                </span>
                <span>{future || beforeHistory ? "—" : `${month.mileageKm.toFixed(1)} km`}</span>
                <span>
                  {future || beforeHistory || month.activeDayCount === null
                    ? "—"
                    : `${month.activeDayCount} 天`}
                </span>
                <span>
                  {future || beforeHistory || month.energyWh === null
                    ? "—"
                    : `${(month.energyWh / 1000).toFixed(2)} kWh`}
                </span>
                {month.ridesTruncated ? (
                  <i>
                    明细 {month.visibleRideCount}/{month.rideCount}
                  </i>
                ) : null}
              </button>
            );
          })}
        </div>
      </section>

      <p className="statistics-boundary">
        月度总次数、总里程、总时长和总能耗优先使用 ninecli `travel`
        顶层完整汇总；活跃天数来自完整的每日里程数组。可选择的行程明细仍最多返回 20 条，并会按“明细
        20/总次数”单独标注。`first_time` 之前的月份不会发起空查询。统计不读取 GPS 轨迹和坐标。
      </p>
    </div>
  );
};

interface SummaryCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  unit: string;
}

const SummaryCard = ({ icon, label, value, unit }: SummaryCardProps) => (
  <article className="statistics-summary-card">
    <span>{icon}</span>
    <small>{label}</small>
    <strong>
      {value} <i>{unit}</i>
    </strong>
  </article>
);
