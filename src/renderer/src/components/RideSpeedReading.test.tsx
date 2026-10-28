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
  it.each([25, 41, 64])(
    "does not use an unread upstream speed %s as a track peak",
    (declaredMaxSpeed) => {
      const markup = renderReading(null, { ...ride, declaredMaxSpeed });
      expect(markup).toContain('data-source="unread"');
      expect(markup).toContain("轨迹峰值未读取");
      expect(markup).toContain('class="ride-speed-unavailable">—</strong>');
      expect(markup).not.toContain(`<strong>${declaredMaxSpeed}</strong>`);
    },
  );
  it("shows the same sampled 37 before and after selection rather than substituting interface 41", () => {
    const markup = renderReading({ id: ride.id, declaredMaxSpeed: 41, sampledMaxSpeed: 37 });
    expect(markup).toContain("<strong>37</strong>");
    expect(markup).toContain('data-source="track"');
    expect(markup).toContain("接口极速 41 km/h，仅供参考");
    expect(markup).not.toContain("<strong>41</strong>");
  });
  it("keeps a read-but-unavailable peak empty even when the interface has a value", () => {
    const markup = renderReading({ id: ride.id, declaredMaxSpeed: 64, sampledMaxSpeed: null });
    expect(markup).toContain('data-source="unavailable"');
    expect(markup).not.toContain("<strong>64</strong>");
  });
  it("preserves an observed zero and a genuine 25 km/h track peak", () => {
    for (const sampledMaxSpeed of [0, 25]) {
      expect(renderReading({ id: ride.id, declaredMaxSpeed: 25, sampledMaxSpeed })).toContain(
        `<strong>${sampledMaxSpeed}</strong>`,
      );
    }
  });
});
