import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RideSpeedVerification, RideSummary } from "../../../shared/contracts";
import { RideSpeedReading } from "./RideSpeedReading";

const ride: RideSummary = {
  id: "ride-1",
  startTime: 1_725_165_000,
  endTime: 1_725_165_120,
  mileageKm: 1.2,
  durationSeconds: 120,
  declaredMaxSpeed: 25,
  energyWh: null,
  batteryUsedPercent: null,
  dayMileageKm: null,
};

const renderReading = (verification: RideSpeedVerification | null, summary = ride) =>
  renderToStaticMarkup(<RideSpeedReading ride={summary} verification={verification} />);

describe("RideSpeedReading", () => {
  it("does not present an unverified 25 km/h historical placeholder as a real maximum", () => {
    const markup = renderReading(null);

    expect(markup).toContain('data-source="placeholder"');
    expect(markup).toContain("最高速度待校验，接口摘要25公里每小时未采用");
    expect(markup).toContain("<strong>—</strong>");
    expect(markup).not.toContain("<strong>25</strong>");
  });

  it("replaces the placeholder with a disagreeing sampled trail maximum", () => {
    const markup = renderReading({ id: ride.id, declaredMaxSpeed: 25, sampledMaxSpeed: 70 });

    expect(markup).toContain('data-source="track"');
    expect(markup).toContain("<strong>70</strong>");
    expect(markup).toContain("已纠正");
  });

  it("accepts 25 km/h when the trail itself confirms that maximum", () => {
    const markup = renderReading({ id: ride.id, declaredMaxSpeed: 25, sampledMaxSpeed: 25 });

    expect(markup).toContain('data-source="track"');
    expect(markup).toContain("<strong>25</strong>");
    expect(markup).toContain("轨迹");
  });

  it("keeps the placeholder hidden when a detail has no usable trail samples", () => {
    const markup = renderReading({ id: ride.id, declaredMaxSpeed: 25, sampledMaxSpeed: null });

    expect(markup).toContain('data-source="placeholder"');
    expect(markup).toContain("轨迹没有速度采样");
    expect(markup).toContain("无轨迹");
    expect(markup).not.toContain("<strong>25</strong>");
  });

  it("continues to show a non-placeholder monthly summary before verification", () => {
    const markup = renderReading(null, { ...ride, declaredMaxSpeed: 64 });

    expect(markup).toContain('data-source="summary"');
    expect(markup).toContain("<strong>64</strong>");
  });
});
