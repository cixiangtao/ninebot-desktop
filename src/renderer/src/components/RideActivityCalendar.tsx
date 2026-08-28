import { ChevronDown } from "lucide-react";
import { useState, type CSSProperties } from "react";
import type { RideDaySummary, RideSummary } from "../../../shared/contracts";

interface RideActivityCalendarProps {
  month: string;
  days: RideDaySummary[];
  rides: RideSummary[];
  selectedDay: number | null;
  disabled: boolean;
  onSelectDay: (day: number | null) => void;
}

const weekdays = ["日", "一", "二", "三", "四", "五", "六"];

const getRideDay = ({ startTime }: RideSummary) => new Date(startTime * 1000).getDate();

/** Shows complete daily mileage while distinguishing days whose selectable rows were truncated. */
export const RideActivityCalendar = ({
  month,
  days,
  rides,
  selectedDay,
  disabled,
  onSelectDay,
}: RideActivityCalendarProps) => {
  const [open, setOpen] = useState(false);
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(4));
  const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
  const visibleRideCounts = new Map<number, number>();
  for (const ride of rides) {
    const day = getRideDay(ride);
    visibleRideCounts.set(day, (visibleRideCounts.get(day) ?? 0) + 1);
  }
  const activeDays = days.filter(({ mileageKm }) => mileageKm !== null && mileageKm > 0);
  const longestMileageKm = Math.max(0, ...activeDays.map(({ mileageKm }) => mileageKm ?? 0));
  const dailyMileageComplete = days.every(({ mileageKm }) => mileageKm !== null);

  if (days.length === 0) {
    return (
      <section className="ride-activity-calendar ride-activity-calendar-unavailable">
        <strong>骑行日历</strong>
        <span>九号未返回每日里程</span>
      </section>
    );
  }

  return (
    <section className="ride-activity-calendar" aria-label={`${year}年${monthNumber}月骑行日历`}>
      <button
        className="ride-activity-toggle"
        type="button"
        aria-expanded={open}
        aria-label={`${open ? "收起" : "展开"}骑行日历`}
        onClick={() => setOpen((current) => !current)}
      >
        <strong>骑行日历</strong>
        <span>
          {dailyMileageComplete
            ? `${activeDays.length} 天 · 单日最高 ${longestMileageKm.toFixed(1)} km`
            : `已知 ${activeDays.length} 天 · 部分日期缺失`}
        </span>
        <ChevronDown size={13} className={open ? "rotate-180" : ""} />
      </button>
      {open ? (
        <>
          <div className="ride-activity-weekdays" aria-hidden="true">
            {weekdays.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>
          <div className="ride-activity-days">
            {Array.from({ length: firstWeekday }, (_, index) => (
              <span key={`blank-${index}`} aria-hidden="true" />
            ))}
            {days.map(({ day, mileageKm }) => {
              const active = mileageKm !== null && mileageKm > 0;
              const visibleRideCount = visibleRideCounts.get(day) ?? 0;
              const selected = selectedDay === day;
              const intensity =
                active && longestMileageKm > 0 ? 0.28 + (mileageKm / longestMileageKm) * 0.72 : 0;
              const detailAvailability =
                active && visibleRideCount === 0
                  ? "，整月汇总中有里程，但没有可选择明细"
                  : active
                    ? `，${visibleRideCount} 条可选择明细`
                    : "";
              return (
                <button
                  key={day}
                  className={`${active ? "ride-activity-day-active" : ""} ${selected ? "ride-activity-day-selected" : ""}`}
                  type="button"
                  disabled={disabled || !active}
                  aria-pressed={selected}
                  aria-label={`${monthNumber}月${day}日，${
                    mileageKm === null ? "每日里程未知" : `${mileageKm.toFixed(1)} km`
                  }${detailAvailability}`}
                  title={`${monthNumber}月${day}日 · ${mileageKm?.toFixed(1) ?? "—"} km${detailAvailability}`}
                  onClick={() => onSelectDay(selected ? null : day)}
                  style={{ "--ride-activity-intensity": intensity } as CSSProperties}
                >
                  <span>{day}</span>
                  <i />
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
};
