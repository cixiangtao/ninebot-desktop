import { describe, expect, it } from "vitest";
import type { RideDetail } from "../shared/contracts.js";
import { loadRideSpeedVerifications } from "./ride-speed-verification.js";

const createDetail = (id: string, sampledMaxSpeed: number): RideDetail => ({
  id,
  startTime: 1,
  endTime: 2,
  mileageKm: 1,
  durationSeconds: 1,
  declaredMaxSpeed: 25,
  sampledMaxSpeed,
  averageSpeed: 1,
  energyWh: null,
  batteryUsedPercent: null,
  dayMileageKm: null,
  track: [{ longitude: 116, latitude: 40, speed: sampledMaxSpeed, offsetSeconds: 0 }],
});

describe("monthly ride speed verification", () => {
  it("limits concurrent detail reads and returns only speed summaries", async () => {
    let activeReads = 0;
    let maximumActiveReads = 0;
    const result = await loadRideSpeedVerifications(
      ["ride-1", "ride-2", "ride-3", "ride-4", "ride-5"],
      async (rideId) => {
        activeReads += 1;
        maximumActiveReads = Math.max(maximumActiveReads, activeReads);
        await Promise.resolve();
        activeReads -= 1;
        return createDetail(rideId, 70);
      },
      2,
    );

    expect(maximumActiveReads).toBe(2);
    expect(result.failures).toEqual([]);
    expect(result.rides).toEqual([
      { id: "ride-1", declaredMaxSpeed: 25, sampledMaxSpeed: 70 },
      { id: "ride-2", declaredMaxSpeed: 25, sampledMaxSpeed: 70 },
      { id: "ride-3", declaredMaxSpeed: 25, sampledMaxSpeed: 70 },
      { id: "ride-4", declaredMaxSpeed: 25, sampledMaxSpeed: 70 },
      { id: "ride-5", declaredMaxSpeed: 25, sampledMaxSpeed: 70 },
    ]);
    expect(JSON.stringify(result.rides)).not.toMatch(/longitude|latitude|track/);
  });

  it("preserves successful summaries when an individual upstream read fails", async () => {
    const result = await loadRideSpeedVerifications(["ride-1", "ride-2"], async (rideId) => {
      if (rideId === "ride-2") throw new Error("temporary failure");
      return createDetail(rideId, 68);
    });

    expect(result.rides).toEqual([{ id: "ride-1", declaredMaxSpeed: 25, sampledMaxSpeed: 68 }]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.rideId).toBe("ride-2");
  });
});
