import { describe, expect, it } from "vitest";
import {
  advancePlaybackPosition,
  createRouteData,
  getKeyboardTrackPosition,
  getSpeedColor,
  getSpeedZoneIndex,
  getTrackBounds,
  getTrackInterpolation,
  getTrackPositionFromHorizontalOffset,
  interpolateTrackPoint,
  projectTrack,
  remapTrackPosition,
  summarizeTrackSpeedZones,
  svgPath,
  toMapCoordinate,
} from "./track";

describe("track projection", () => {
  it("fits a route into the requested viewport", () => {
    const points = projectTrack(
      [
        { longitude: 1, latitude: 1, speed: 0, offsetSeconds: 0 },
        { longitude: 3, latitude: 2, speed: 10, offsetSeconds: 10 },
      ],
      100,
      80,
      10,
    );
    expect(points[0]).toMatchObject({ x: 10, y: 70 });
    expect(points[1]).toMatchObject({ x: 90, y: 10 });
    expect(svgPath(points)).toBe("M10.0 70.0 L90.0 10.0");
  });
});

describe("map track data", () => {
  const track = [
    { longitude: 121.52, latitude: 31.21, speed: 0, offsetSeconds: 0 },
    { longitude: 121.56, latitude: 31.19, speed: 24, offsetSeconds: 10 },
  ];

  it("keeps MapLibre coordinates in longitude-latitude order", () => {
    expect(toMapCoordinate(track[0]!)).toEqual([121.52, 31.21]);
    expect(createRouteData(track).features[0]).toMatchObject({
      properties: { speed: 12 },
      geometry: {
        coordinates: [
          [121.52, 31.21],
          [121.56, 31.19],
        ],
      },
    });
  });

  it("creates independently colored segments without bridging invalid coordinates", () => {
    const segmented = createRouteData([
      ...track,
      { longitude: 220, latitude: 31.2, speed: 60, offsetSeconds: 20 },
      { longitude: 121.6, latitude: 31.18, speed: 70, offsetSeconds: 30 },
    ]);

    expect(segmented.features).toHaveLength(1);
    expect(getSpeedColor(0)).toBe("#5b83c6");
    expect(getSpeedColor(15)).toBe("#16b7a8");
    expect(getSpeedColor(44.9)).toBe("#e8b43d");
    expect(getSpeedColor(65)).toBe("#e34f5f");
    expect(getSpeedZoneIndex(44.9)).toBe(2);
  });

  it("computes southwest and northeast bounds", () => {
    expect(getTrackBounds(track)).toEqual([
      [121.52, 31.19],
      [121.56, 31.21],
    ]);
  });

  it("does not create invalid line data", () => {
    expect(createRouteData(track.slice(0, 1)).features).toEqual([]);
    expect(getTrackBounds([])).toBeNull();
    expect(
      toMapCoordinate({ longitude: 200, latitude: 31, speed: 0, offsetSeconds: 0 }),
    ).toBeNull();
  });
});

describe("speed-zone distance analysis", () => {
  it("assigns equal geographic segments to all five shared speed zones", () => {
    const zones = summarizeTrackSpeedZones([
      { longitude: 0, latitude: 0, speed: 0, offsetSeconds: 0 },
      { longitude: 0.01, latitude: 0, speed: 10, offsetSeconds: 10 },
      { longitude: 0.02, latitude: 0, speed: 20, offsetSeconds: 20 },
      { longitude: 0.03, latitude: 0, speed: 40, offsetSeconds: 30 },
      { longitude: 0.04, latitude: 0, speed: 50, offsetSeconds: 40 },
      { longitude: 0.05, latitude: 0, speed: 70, offsetSeconds: 50 },
    ]);

    expect(zones.map(({ label }) => label)).toEqual(["0–15", "15–30", "30–45", "45–60", "60+"]);
    for (const { distanceShare } of zones) expect(distanceShare).toBeCloseTo(0.2, 10);
    expect(zones.map(({ peakPosition }) => peakPosition)).toEqual([0.5, 1.5, 2.5, 3.5, 4.5]);
  });

  it("returns empty zones when no valid geographic segment exists", () => {
    const zones = summarizeTrackSpeedZones([
      { longitude: 200, latitude: 0, speed: 70, offsetSeconds: 0 },
    ]);
    expect(
      zones.every(
        ({ distanceKm, distanceShare, peakPosition }) =>
          distanceKm === 0 && distanceShare === 0 && peakPosition === null,
      ),
    ).toBe(true);
  });
});

describe("continuous playback", () => {
  const track = [
    { longitude: 116, latitude: 39, speed: 10, offsetSeconds: 0 },
    { longitude: 118, latitude: 41, speed: 30, offsetSeconds: 20 },
  ];

  it("interpolates every synchronized value at a fractional position", () => {
    expect(interpolateTrackPoint(track, 0.25)).toEqual({
      longitude: 116.5,
      latitude: 39.5,
      speed: 15,
      offsetSeconds: 5,
    });
  });

  it("clamps playback positions and handles empty tracks", () => {
    expect(getTrackInterpolation(2, 5)).toEqual({ fromIndex: 1, toIndex: 1, ratio: 0 });
    expect(interpolateTrackPoint(track, -2)).toEqual(track[0]);
    expect(interpolateTrackPoint([], 0)).toBeNull();
  });

  it("advances fractional positions at the selected playback rate", () => {
    expect(advancePlaybackPosition(10, 90, 0.5, 180)).toBe(10.25);
    expect(advancePlaybackPosition(10, 90, 1, 180)).toBe(10.5);
    expect(advancePlaybackPosition(10, 90, 2, 180)).toBe(11);
    expect(advancePlaybackPosition(10, 90, 4, 180)).toBe(12);
    expect(advancePlaybackPosition(10, -20, 2, 180)).toBe(10);
  });

  it("maps chart pointer offsets to the same fractional playback position", () => {
    expect(getTrackPositionFromHorizontalOffset(250, 1_000, 101)).toBe(25);
    expect(getTrackPositionFromHorizontalOffset(-10, 1_000, 101)).toBe(0);
    expect(getTrackPositionFromHorizontalOffset(1_100, 1_000, 101)).toBe(100);
    expect(getTrackPositionFromHorizontalOffset(20, 0, 101)).toBe(0);
  });

  it("preserves relative playback progress across refreshed sample counts", () => {
    expect(remapTrackPosition(49.5, 100, 200)).toBeCloseTo(99.5);
    expect(remapTrackPosition(150, 100, 20)).toBe(19);
    expect(remapTrackPosition(Number.NaN, 100, 20)).toBe(0);
    expect(remapTrackPosition(12, 1, 20)).toBe(0);
    expect(remapTrackPosition(12, 20, 1)).toBe(0);
  });

  it("moves chart keyboard navigation to exact samples and supports larger steps", () => {
    expect(getKeyboardTrackPosition(10.4, "ArrowRight", false, 20)).toBe(11);
    expect(getKeyboardTrackPosition(10.4, "ArrowLeft", false, 20)).toBe(10);
    expect(getKeyboardTrackPosition(10.4, "ArrowRight", true, 20)).toBe(15);
    expect(getKeyboardTrackPosition(10.4, "Home", false, 20)).toBe(0);
    expect(getKeyboardTrackPosition(10.4, "End", false, 20)).toBe(19);
    expect(getKeyboardTrackPosition(10.4, "Enter", false, 20)).toBeNull();
  });
});
