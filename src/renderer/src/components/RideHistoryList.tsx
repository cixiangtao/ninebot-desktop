import { useEffect, useRef } from "react";
import type { RideSpeedVerification, RideSummary } from "../../../shared/contracts";
import { formatLongDuration, formatRideListDuration } from "../lib/format";
import { RideSpeedReading } from "./RideSpeedReading";

interface RideHistoryListProps {
  rides: RideSummary[];
  selectedRideId: string | null;
  verifications: Readonly<Record<string, RideSpeedVerification>>;
  truncated?: boolean;
  onSelect: (ride: RideSummary) => void;
  onVisibleRidesChange?: (ids: string[]) => void;
}

const dayFormatter = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" });
const dateKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const clockFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The group supplies the start date. A day offset keeps midnight crossings compact and explicit. */
export const formatRideCardTime = (startTime: number, endTime: number) => {
  const start = new Date(startTime * 1000);
  const end = new Date(endTime * 1000);
  const startValid = startTime > 0 && Number.isFinite(start.getTime());
  const endValid =
    endTime > 0 && Number.isFinite(end.getTime()) && (!startValid || endTime >= startTime);
  const startText = startValid ? clockFormatter.format(start) : "—";
  if (!endValid) return `${startText}–—`;
  if (!startValid) return `—–${dayFormatter.format(end)} ${clockFormatter.format(end)}`;
  const dayOffset = Math.round(
    (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
      Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
      86400000,
  );
  return `${startText}–${dayOffset === 1 ? "次日 " : dayOffset > 1 ? `+${dayOffset}天 ` : ""}${clockFormatter.format(end)}`;
};

/** Groups selectable rides by their local start date; sums cover only the available records. */
export const groupRideHistory = (rides: RideSummary[]) => {
  const groups = new Map<
    string,
    { date: Date; rides: RideSummary[]; mileageKm: number; durationSeconds: number }
  >();
  for (const ride of rides.toSorted((a, b) => b.startTime - a.startTime)) {
    const date = new Date(ride.startTime * 1000);
    const key = dateKey(date);
    const group = groups.get(key) ?? { date, rides: [], mileageKm: 0, durationSeconds: 0 };
    group.rides.push(ride);
    group.mileageKm += ride.mileageKm;
    group.durationSeconds += ride.durationSeconds;
    groups.set(key, group);
  }
  return [...groups.entries()];
};

export const RideHistoryList = ({
  rides,
  selectedRideId,
  verifications,
  truncated = false,
  onSelect,
  onVisibleRidesChange,
}: RideHistoryListProps) => {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list || !onVisibleRidesChange) return;
    const currentIds = new Set(rides.map(({ id }) => id));
    const visible = new Set<string>();
    const cards = [...list.querySelectorAll<HTMLButtonElement>("[data-ride-id]")];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLButtonElement).dataset.rideId;
          if (!id || !currentIds.has(id)) continue;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        onVisibleRidesChange(
          cards.flatMap((card) => {
            const id = card.dataset.rideId;
            return id && visible.has(id) ? [id] : [];
          }),
        );
      },
      { root: list.closest(".ride-list"), rootMargin: "140px 0px" },
    );
    for (const card of cards) observer.observe(card);
    return () => {
      observer.disconnect();
      onVisibleRidesChange([]);
    };
  }, [rides, onVisibleRidesChange]);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  return (
    <div className="ride-history-groups" ref={listRef}>
      {groupRideHistory(rides).map(([key, group]) => {
        const dayLabel =
          key === dateKey(today)
            ? "今天"
            : key === dateKey(yesterday)
              ? "昨天"
              : dayFormatter.format(group.date);
        return (
          <section className="ride-day-group" key={key} aria-label={dayLabel}>
            <header className="ride-day-heading">
              <h3>{dayLabel}</h3>
              <span
                className="ride-day-total"
                title={
                  truncated ? "当前可选记录合计，可能不含全天所有行程" : "当天骑行总里程与总耗时"
                }
              >
                {truncated ? <small>可选合计 </small> : null}
                {group.mileageKm.toFixed(1)} km · {formatRideListDuration(group.durationSeconds)}
              </span>
            </header>
            <div className="ride-day-cards">
              {group.rides.map((ride) => (
                <button
                  key={ride.id}
                  data-ride-id={ride.id}
                  type="button"
                  className={`ride-row ${selectedRideId === ride.id ? "ride-row-active" : ""}`}
                  aria-pressed={selectedRideId === ride.id}
                  onClick={() => onSelect(ride)}
                >
                  <span className="ride-card-identity">
                    <span className="ride-card-time">
                      {formatRideCardTime(ride.startTime, ride.endTime)}
                    </span>
                    <span
                      className="ride-card-summary"
                      title={`里程 ${ride.mileageKm.toFixed(1)} km，用时 ${formatLongDuration(ride.durationSeconds)}`}
                    >
                      <span className="ride-card-distance">
                        <strong>{ride.mileageKm.toFixed(1)}</strong> km
                      </span>
                      <span className="ride-card-duration">
                        <span aria-hidden="true">·</span>
                        <span>{formatRideListDuration(ride.durationSeconds)}</span>
                      </span>
                    </span>
                  </span>
                  <span className="ride-card-speed">
                    <span className="ride-card-speed-label">轨迹峰值</span>
                    <RideSpeedReading ride={ride} verification={verifications[ride.id] ?? null} />
                  </span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
};
