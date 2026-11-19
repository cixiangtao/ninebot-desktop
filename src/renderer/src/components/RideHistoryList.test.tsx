import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RideSummary } from "../../../shared/contracts";
import { formatRideListDuration } from "../lib/format";
import { formatRideCardTime, groupRideHistory, RideHistoryList } from "./RideHistoryList";

const ride: RideSummary = {
  id: "a",
  startTime: new Date(2026, 9, 28, 18, 10).getTime() / 1000,
  endTime: new Date(2026, 9, 28, 18, 30).getTime() / 1000,
  mileageKm: 12.2,
  durationSeconds: 1200,
  declaredMaxSpeed: 25,
  energyWh: null,
  batteryUsedPercent: null,
  dayMileageKm: 40,
};
const onSelect = () => {};
const missingDataRides = [ride];
const energyRides = [{ ...ride, energyWh: 244, batteryUsedPercent: 7 }];

describe("RideHistoryList", () => {
  it("groups by local start day and sorts recent first", () => {
    const earlier = { ...ride, id: "b", startTime: ride.startTime - 3600, mileageKm: 1 };
    const crossMidnight = {
      ...ride,
      id: "c",
      startTime: new Date(2026, 9, 27, 23, 50).getTime() / 1000,
    };
    const groups = groupRideHistory([earlier, crossMidnight, ride]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.[1].rides.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(groups[0]?.[1].mileageKm).toBeCloseTo(13.2);
    expect(groups[0]?.[1].durationSeconds).toBe(2400);
    expect(groups[1]?.[1].date.getDate()).toBe(27);
  });

  it("keeps the cards focused on ride identity and speed without energy metrics", () => {
    const markup = renderToStaticMarkup(
      <RideHistoryList
        rides={missingDataRides}
        selectedRideId={ride.id}
        verifications={{}}
        onSelect={onSelect}
      />,
    );
    expect(markup).not.toContain("可选合计");
    expect(markup).toContain("18:10–18:30");
    expect(markup).toContain("20min");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("轨迹峰值未读取");
    expect(markup).toContain('data-source="unread"');
    expect(markup).not.toContain("40.0 km");
    expect(markup).toContain("未读取");
    expect(markup).not.toContain("耗电");
    expect(markup).not.toContain("Wh/km");
  });

  it("labels incomplete daily sums as selectable totals rather than complete day mileage", () => {
    const markup = renderToStaticMarkup(
      <RideHistoryList
        rides={missingDataRides}
        selectedRideId={null}
        verifications={{}}
        truncated
        onSelect={onSelect}
      />,
    );
    expect(markup).toContain("可选合计");
    expect(markup).toContain("12.2 km · 20min");
    expect(markup).not.toContain("40.0 km");
  });

  it("shows the sourced track maximum while leaving energy metrics in the detail view", () => {
    const markup = renderToStaticMarkup(
      <RideHistoryList
        rides={energyRides}
        selectedRideId={null}
        verifications={{ a: { id: "a", sampledMaxSpeed: 70, declaredMaxSpeed: 25 } }}
        onSelect={onSelect}
      />,
    );
    expect(markup).not.toContain("Wh/km");
    expect(markup).not.toContain("7%");
    expect(markup).toContain("<strong>70</strong>");
    expect(markup).toContain("接口极速 25 km/h，仅供参考");
    expect(markup).not.toContain("可选合计");
  });
});

describe("compact ride times", () => {
  it("formats minute summaries and carries rounded minutes into hours", () => {
    expect(formatRideListDuration(1529)).toBe("25min");
    expect(formatRideListDuration(3900)).toBe("1h 05min");
    expect(formatRideListDuration(3599)).toBe("1h");
    expect(formatRideListDuration(23)).toBe("<1min");
    expect(formatRideListDuration(0)).toBe("0min");
    expect(formatRideListDuration(Number.NaN)).toBe("—");
  });

  it("uses padded 24-hour times and explicit day offsets across midnight and years", () => {
    const start = new Date(2026, 11, 31, 23, 50).getTime() / 1000;
    expect(formatRideCardTime(start, new Date(2027, 0, 1, 0, 20).getTime() / 1000)).toBe(
      "23:50–次日 00:20",
    );
    expect(formatRideCardTime(start, new Date(2027, 0, 2, 8, 5).getTime() / 1000)).toBe(
      "23:50–+2天 08:05",
    );
    expect(formatRideCardTime(ride.startTime, 0)).toBe("18:10–—");
    expect(formatRideCardTime(ride.startTime, ride.startTime - 60)).toBe("18:10–—");
  });
});
