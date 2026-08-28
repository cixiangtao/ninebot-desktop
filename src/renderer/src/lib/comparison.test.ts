import { describe, expect, it } from "vitest";
import type { RideDetail } from "../../../shared/contracts";
import {
  createRideComparisonMetrics,
  formatSignedDecimal,
  formatSignedDuration,
} from "./comparison";

const createDetail = (overrides: Partial<RideDetail> = {}): RideDetail => ({
  id: "ride-1",
  startTime: 100,
  endTime: 700,
  mileageKm: 8,
  durationSeconds: 600,
  declaredMaxSpeed: 25,
  energyWh: 220,
  batteryUsedPercent: 4,
  dayMileageKm: 12,
  sampledMaxSpeed: 70,
  averageSpeed: 48,
  track: [],
  ...overrides,
});

describe("ride comparison metrics", () => {
  it("compares sampled maxima instead of the historical 25 km/h summary cap", () => {
    const metrics = createRideComparisonMetrics(
      createDetail(),
      createDetail({
        id: "ride-2",
        sampledMaxSpeed: 64,
        averageSpeed: 42.5,
        mileageKm: 9.2,
        durationSeconds: 720,
        energyWh: 280,
        batteryUsedPercent: 5,
      }),
    );

    expect(metrics[0]).toEqual(
      expect.objectContaining({
        key: "maximumSpeed",
        baseValue: 70,
        comparisonValue: 64,
        delta: -6,
      }),
    );
    expect(metrics[1]).toEqual(expect.objectContaining({ key: "averageSpeed", delta: -5.5 }));
    expect(metrics[2]?.key).toBe("mileage");
    expect(metrics[2]?.delta).toBeCloseTo(1.2, 8);
    expect(metrics[3]).toEqual(expect.objectContaining({ key: "duration", delta: 120 }));
    expect(metrics[4]).toEqual(expect.objectContaining({ key: "energy", delta: 60 }));
    expect(metrics[5]).toEqual(
      expect.objectContaining({
        key: "efficiency",
        baseValue: 27.5,
        comparisonValue: expect.closeTo(280 / 9.2, 8),
        delta: expect.closeTo(280 / 9.2 - 27.5, 8),
      }),
    );
    expect(metrics[6]).toEqual(expect.objectContaining({ key: "batteryUsed", delta: 1 }));
  });

  it("keeps efficiency unavailable when energy or positive mileage is missing", () => {
    const metrics = createRideComparisonMetrics(
      createDetail({ energyWh: null }),
      createDetail({ id: "ride-2", mileageKm: 0 }),
    );

    expect(metrics[5]).toEqual(
      expect.objectContaining({
        key: "efficiency",
        baseValue: null,
        comparisonValue: null,
        delta: null,
      }),
    );
  });

  it("formats neutral signed deltas for measurements and durations", () => {
    expect(formatSignedDecimal(1.24, 1)).toBe("+1.2");
    expect(formatSignedDecimal(-6, 0)).toBe("−6");
    expect(formatSignedDecimal(0, 1)).toBe("0.0");
    expect(formatSignedDuration(125)).toBe("+2分05秒");
    expect(formatSignedDuration(-43)).toBe("−43秒");
    expect(formatSignedDuration(0)).toBe("0秒");
  });
});
