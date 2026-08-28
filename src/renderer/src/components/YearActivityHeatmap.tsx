import type { CSSProperties } from "react";
import type { YearSummaryExportMonth } from "../../../shared/contracts";
import { createYearActivityInsights } from "../lib/statistics";

interface YearActivityHeatmapProps {
  year: number;
  months: YearSummaryExportMonth[];
  historyStartTime: number | null;
  loading: boolean;
  onSelectMonth: (month: string) => void;
}

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];

const formatDay = (month: string, day: number) => `${Number(month.slice(4))}月${day}日`;

/** Visualizes complete daily mileage without requesting ride details or GPS trails. */
export const YearActivityHeatmap = ({
  year,
  months,
  historyStartTime,
  loading,
  onSelectMonth,
}: YearActivityHeatmapProps) => {
  const insights = createYearActivityInsights(year, months, historyStartTime);
  const hasRides = months.some(({ summary }) => summary.rideCount > 0);
  const dailyMileageUnavailable = hasRides && insights.knownDayCount === 0;
  if (insights.days.length === 0 || dailyMileageUnavailable || insights.activeDayCount === 0) {
    return (
      <section className="year-activity-card" aria-label={`${year}年骑行活动`}>
        <div className="statistics-section-heading">
          <div>
            <span>年度活动</span>
            <strong>每日里程热力图</strong>
          </div>
        </div>
        <div className="year-activity-empty" role="status">
          <strong>
            {loading
              ? "正在读取每日里程"
              : dailyMileageUnavailable
                ? "每日里程暂不可用"
                : "这一年暂无活动记录"}
          </strong>
          <span>
            {loading
              ? "月度统计完成后会在这里生成年度活动图。"
              : dailyMileageUnavailable
                ? "九号返回了月度汇总，但没有提供可用的每日数组。"
                : "可以切换其他年份继续查看。"}
          </span>
        </div>
      </section>
    );
  }

  const monthLabels = months.flatMap(({ summary }) => {
    const firstDay = insights.days.find(({ month }) => month === summary.month);
    return firstDay ? [{ month: summary.month, weekIndex: firstDay.weekIndex }] : [];
  });
  const bestDay = insights.bestDay;

  return (
    <section className="year-activity-card" aria-label={`${year}年骑行活动热力图`}>
      <div className="statistics-section-heading">
        <div>
          <span>年度活动</span>
          <strong>每日里程热力图</strong>
        </div>
        <small>点击有里程的日期查看当月记录</small>
      </div>

      <div className="year-activity-insights">
        <div className="year-activity-record">
          <span>最高里程日</span>
          <strong>{bestDay ? formatDay(bestDay.month, bestDay.day) : "暂无记录"}</strong>
          <small>{bestDay ? `${bestDay.mileageKm?.toFixed(1)} km` : "—"}</small>
        </div>
        <dl>
          <div>
            <dt>最长连续骑行</dt>
            <dd>{insights.longestActiveStreak} 天</dd>
          </div>
          <div>
            <dt>最常骑行</dt>
            <dd>
              {insights.favoriteWeekday === null
                ? "—"
                : `星期${weekdays[insights.favoriteWeekday]}`}
            </dd>
          </div>
          <div>
            <dt>活动覆盖</dt>
            <dd>
              {insights.activeDayCount} / {insights.knownDayCount} 天
            </dd>
          </div>
        </dl>
      </div>

      <div
        className="year-activity-scroll"
        style={{ "--year-activity-weeks": insights.weekCount } as CSSProperties}
      >
        <div className="year-activity-months" aria-hidden="true">
          {monthLabels.map(({ month, weekIndex }) => (
            <span key={month} style={{ gridColumn: weekIndex + 1 }}>
              {Number(month.slice(4))}月
            </span>
          ))}
        </div>
        <div className="year-activity-body">
          <div className="year-activity-weekdays" aria-hidden="true">
            {weekdays.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>
          <div className="year-activity-grid">
            {insights.days.map((day) => {
              const active = day.mileageKm !== null && day.mileageKm > 0;
              const intensity =
                active && insights.maximumMileageKm > 0
                  ? 0.22 + ((day.mileageKm ?? 0) / insights.maximumMileageKm) * 0.78
                  : 0;
              const label = `${formatDay(day.month, day.day)}，${
                day.mileageKm === null ? "里程未知" : `${day.mileageKm.toFixed(1)} km`
              }`;
              return (
                <button
                  key={`${day.month}-${day.day}`}
                  type="button"
                  className={active ? "year-activity-day-active" : ""}
                  disabled={!active}
                  aria-label={label}
                  title={label}
                  onClick={() => onSelectMonth(day.month)}
                  style={
                    {
                      gridColumn: day.weekIndex + 1,
                      gridRow: day.weekday + 1,
                      "--year-activity-intensity": intensity,
                    } as CSSProperties
                  }
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="year-activity-legend">
        <span>少</span>
        {[0, 0.28, 0.5, 0.72, 1].map((intensity) => (
          <i
            key={intensity}
            className={intensity > 0 ? "year-activity-day-active" : ""}
            style={{ "--year-activity-intensity": intensity } as CSSProperties}
          />
        ))}
        <span>多</span>
      </div>
    </section>
  );
};
