import { describe, expect, it } from "vitest";
import { createDemoDetail, demoRides } from "./demo";

describe("demo ride details", () => {
  it("scales every synthetic trail to the selected ride duration", () => {
    for (const ride of demoRides) {
      const detail = createDemoDetail(ride);
      expect(detail.track[0]?.offsetSeconds).toBe(0);
      expect(detail.track.at(-1)?.offsetSeconds).toBe(ride.durationSeconds);
      expect(detail.track.every(({ offsetSeconds }) => offsetSeconds <= ride.durationSeconds)).toBe(
        true,
      );
    }
  });
});
