import { describe, expect, it } from "vitest";
import {
  createMapDisplayTrack,
  getCoordinatePreviewShiftMeters,
  isCoordinatePreviewAvailable,
  resolveMapCoordinate,
} from "./coordinate";

describe("coordinate calibration preview", () => {
  it("matches gcoord's documented GCJ-02 to WGS84 example", () => {
    const result = resolveMapCoordinate({ longitude: 123, latitude: 45 }, "gcj02-to-wgs84-preview");

    expect(result?.[0]).toBeCloseTo(122.99395597, 7);
    expect(result?.[1]).toBeCloseTo(44.99804071, 7);
  });

  it("keeps source coordinates unchanged outside the supported comparison region", () => {
    const source = { longitude: -73.9749, latitude: 40.7736 };

    expect(isCoordinatePreviewAvailable(source)).toBe(false);
    expect(resolveMapCoordinate(source, "gcj02-to-wgs84-preview")).toEqual([
      source.longitude,
      source.latitude,
    ]);
    expect(getCoordinatePreviewShiftMeters(source)).toBeNull();
  });

  it("creates a map-only trail copy without changing source samples or playback data", () => {
    const track = [{ longitude: 116.403988, latitude: 39.914266, speed: 42, offsetSeconds: 12 }];
    const preview = createMapDisplayTrack(track, "gcj02-to-wgs84-preview");

    expect(preview).not.toBe(track);
    expect(preview[0]).not.toBe(track[0]);
    expect(preview[0]?.longitude).not.toBe(track[0]?.longitude);
    expect(preview[0]?.speed).toBe(42);
    expect(preview[0]?.offsetSeconds).toBe(12);
    expect(track[0]).toEqual({
      longitude: 116.403988,
      latitude: 39.914266,
      speed: 42,
      offsetSeconds: 12,
    });
  });

  it("returns the original trail reference when source display is selected", () => {
    const track = [{ longitude: 116, latitude: 40, speed: 1, offsetSeconds: 0 }];

    expect(createMapDisplayTrack(track, "source")).toBe(track);
  });

  it("reports a plausible local comparison displacement without exposing coordinates", () => {
    const shift = getCoordinatePreviewShiftMeters({ longitude: 116.403988, latitude: 39.914266 });

    expect(shift).not.toBeNull();
    expect(shift ?? 0).toBeGreaterThan(100);
    expect(shift ?? 0).toBeLessThan(1_000);
  });
});
