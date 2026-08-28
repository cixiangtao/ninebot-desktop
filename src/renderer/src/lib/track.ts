import type { TrackPoint } from "../../../shared/contracts";

export type MapCoordinate = [longitude: number, latitude: number];

export interface RouteFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: {
      /** Average speed of the two samples joined by this segment, in km/h. */
      speed: number;
    };
    geometry: {
      type: "LineString";
      coordinates: MapCoordinate[];
    };
  }>;
}

export type TrackBounds = [southwest: MapCoordinate, northeast: MapCoordinate];

export interface TrackInterpolation {
  fromIndex: number;
  toIndex: number;
  ratio: number;
}

export interface ProjectedPoint extends TrackPoint {
  x: number;
  y: number;
}

export const playbackRates = [0.5, 1, 2, 4] as const;
export type PlaybackRate = (typeof playbackRates)[number];

export const speedColorStops = [
  { minimumSpeed: 0, label: "0–15", color: "#5b83c6" },
  { minimumSpeed: 15, label: "15–30", color: "#16b7a8" },
  { minimumSpeed: 30, label: "30–45", color: "#e8b43d" },
  { minimumSpeed: 45, label: "45–60", color: "#f17843" },
  { minimumSpeed: 60, label: "60+", color: "#e34f5f" },
] as const;

export interface TrackSpeedZone {
  minimumSpeed: number;
  maximumSpeed: number | null;
  label: string;
  color: string;
  /** Geographic distance represented by trail segments in this speed zone. */
  distanceKm: number;
  /** Fraction from 0 to 1 of the valid geographic trail distance. */
  distanceShare: number;
  /** Fractional trail index of the fastest segment assigned to this zone. */
  peakPosition: number | null;
}

/** Returns the shared speed-zone index for map colors and ride analysis. */
export const getSpeedZoneIndex = (speed: number) => {
  const finiteSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  return speedColorStops.findLastIndex(({ minimumSpeed }) => finiteSpeed >= minimumSpeed);
};

/** Returns the shared online/offline route color for a speed sample. */
export const getSpeedColor = (speed: number) => {
  const zone = speedColorStops[getSpeedZoneIndex(speed)];
  return zone?.color ?? speedColorStops[0].color;
};

/** Advances a fractional sample index using a stable base duration and selected playback rate. */
export const advancePlaybackPosition = (
  currentPosition: number,
  elapsedMilliseconds: number,
  playbackRate: PlaybackRate,
  segmentDurationMilliseconds: number,
) => {
  const safeElapsed = Number.isFinite(elapsedMilliseconds) ? Math.max(0, elapsedMilliseconds) : 0;
  const safeDuration = Number.isFinite(segmentDurationMilliseconds)
    ? Math.max(1, segmentDurationMilliseconds)
    : 1;
  return currentPosition + (safeElapsed * playbackRate) / safeDuration;
};

/** Fits geographic points into an SVG viewport while retaining route shape. */
export const projectTrack = (
  track: TrackPoint[],
  width: number,
  height: number,
  padding: number,
): ProjectedPoint[] => {
  if (track.length === 0) return [];
  const longitudes = track.map(({ longitude }) => longitude);
  const latitudes = track.map(({ latitude }) => latitude);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const longitudeSpan = Math.max(maxLongitude - minLongitude, Number.EPSILON);
  const latitudeSpan = Math.max(maxLatitude - minLatitude, Number.EPSILON);

  return track.map((point) => ({
    ...point,
    x: padding + ((point.longitude - minLongitude) / longitudeSpan) * (width - padding * 2),
    y: height - padding - ((point.latitude - minLatitude) / latitudeSpan) * (height - padding * 2),
  }));
};

export const svgPath = (points: Array<{ x: number; y: number }>) =>
  points
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");

/** Locates a fractional playback position between two adjacent samples. */
export const getTrackInterpolation = (
  trackLength: number,
  position: number,
): TrackInterpolation | null => {
  if (trackLength <= 0) return null;
  const maximum = trackLength - 1;
  const finitePosition = Number.isFinite(position) ? position : 0;
  const clampedPosition = Math.min(maximum, Math.max(0, finitePosition));
  const fromIndex = Math.floor(clampedPosition);
  const toIndex = Math.min(maximum, fromIndex + 1);

  return { fromIndex, toIndex, ratio: clampedPosition - fromIndex };
};

/** Converts a horizontal pointer offset into the shared fractional playback position. */
export const getTrackPositionFromHorizontalOffset = (
  offsetPixels: number,
  widthPixels: number,
  trackLength: number,
) => {
  if (trackLength <= 1 || !Number.isFinite(widthPixels) || widthPixels <= 0) return 0;
  const safeOffset = Number.isFinite(offsetPixels) ? offsetPixels : 0;
  const ratio = Math.min(1, Math.max(0, safeOffset / widthPixels));
  return ratio * (trackLength - 1);
};

/** Preserves relative playback progress when a refreshed trail changes sample count. */
export const remapTrackPosition = (
  position: number,
  previousTrackLength: number,
  nextTrackLength: number,
) => {
  if (nextTrackLength <= 1 || previousTrackLength <= 1) return 0;
  const previousMaximum = previousTrackLength - 1;
  const nextMaximum = nextTrackLength - 1;
  const finitePosition = Number.isFinite(position) ? position : 0;
  const ratio = Math.min(1, Math.max(0, finitePosition / previousMaximum));
  return ratio * nextMaximum;
};

/** Resolves one keyboard navigation action to an exact trail sample. */
export const getKeyboardTrackPosition = (
  position: number,
  key: string,
  largeStep: boolean,
  trackLength: number,
) => {
  if (trackLength <= 0) return null;
  const maximum = trackLength - 1;
  const current = Math.min(maximum, Math.max(0, Number.isFinite(position) ? position : 0));
  const step = largeStep ? 5 : 1;
  if (key === "Home") return 0;
  if (key === "End") return maximum;
  if (key === "ArrowLeft") return Math.max(0, Math.ceil(current) - step);
  if (key === "ArrowRight") return Math.min(maximum, Math.floor(current) + step);
  return null;
};

const interpolateNumber = (from: number, to: number, ratio: number) => from + (to - from) * ratio;

/** Interpolates location, speed, and elapsed time without mutating raw samples. */
export const interpolateTrackPoint = (track: TrackPoint[], position: number): TrackPoint | null => {
  const interpolation = getTrackInterpolation(track.length, position);
  if (!interpolation) return null;
  const from = track[interpolation.fromIndex];
  const to = track[interpolation.toIndex];
  if (!from || !to) return null;

  return {
    longitude: interpolateNumber(from.longitude, to.longitude, interpolation.ratio),
    latitude: interpolateNumber(from.latitude, to.latitude, interpolation.ratio),
    speed: interpolateNumber(from.speed, to.speed, interpolation.ratio),
    offsetSeconds: interpolateNumber(from.offsetSeconds, to.offsetSeconds, interpolation.ratio),
  };
};

/** Converts a track point into MapLibre's longitude-latitude order. */
export const toMapCoordinate = ({ longitude, latitude }: TrackPoint): MapCoordinate | null => {
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null;
  }

  return [longitude, latitude];
};

const EARTH_RADIUS_KM = 6_371.0088;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const calculateSegmentDistanceKm = (from: TrackPoint, to: TrackPoint) => {
  const fromCoordinate = toMapCoordinate(from);
  const toCoordinate = toMapCoordinate(to);
  if (!fromCoordinate || !toCoordinate) return 0;
  const fromLongitude = toRadians(fromCoordinate[0]);
  const fromLatitude = toRadians(fromCoordinate[1]);
  const toLongitude = toRadians(toCoordinate[0]);
  const toLatitude = toRadians(toCoordinate[1]);
  const latitudeDelta = toLatitude - fromLatitude;
  const longitudeDelta = toLongitude - fromLongitude;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
};

/** Summarizes valid geographic trail distance into the five shared speed zones. */
export const summarizeTrackSpeedZones = (track: TrackPoint[]): TrackSpeedZone[] => {
  const zones = speedColorStops.map(({ minimumSpeed, label, color }, index) => ({
    minimumSpeed,
    maximumSpeed: speedColorStops[index + 1]?.minimumSpeed ?? null,
    label,
    color,
    distanceKm: 0,
    peakSegmentSpeed: Number.NEGATIVE_INFINITY,
    peakPosition: null as number | null,
  }));

  for (const [index, from] of track.slice(0, -1).entries()) {
    const to = track[index + 1];
    if (!to) continue;
    const distanceKm = calculateSegmentDistanceKm(from, to);
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) continue;
    const segmentSpeed = Math.max(0, (from.speed + to.speed) / 2);
    const zone = zones[getSpeedZoneIndex(segmentSpeed)];
    if (!zone) continue;
    zone.distanceKm += distanceKm;
    if (segmentSpeed > zone.peakSegmentSpeed) {
      zone.peakSegmentSpeed = segmentSpeed;
      zone.peakPosition = index + 0.5;
    }
  }

  const totalDistanceKm = zones.reduce((total, { distanceKm }) => total + distanceKm, 0);
  return zones.map(({ peakSegmentSpeed: _peakSegmentSpeed, ...zone }) => ({
    ...zone,
    distanceShare: totalDistanceKm > 0 ? zone.distanceKm / totalDistanceKm : 0,
  }));
};

/** Builds renderer-local GeoJSON; no route payload is sent to the tile provider. */
export const createRouteData = (track: TrackPoint[]): RouteFeatureCollection => {
  const features = track.slice(0, -1).flatMap((from, index) => {
    const to = track[index + 1];
    if (!to) return [];
    const fromCoordinate = toMapCoordinate(from);
    const toCoordinate = toMapCoordinate(to);
    if (!fromCoordinate || !toCoordinate) return [];
    const fromSpeed = Number.isFinite(from.speed) ? Math.max(0, from.speed) : 0;
    const toSpeed = Number.isFinite(to.speed) ? Math.max(0, to.speed) : 0;
    return [
      {
        type: "Feature" as const,
        properties: { speed: (fromSpeed + toSpeed) / 2 },
        geometry: { type: "LineString" as const, coordinates: [fromCoordinate, toCoordinate] },
      },
    ];
  });

  return {
    type: "FeatureCollection",
    features,
  };
};

/** Returns the geographic bounds of all valid points, or null for an empty track. */
export const getTrackBounds = (track: TrackPoint[]): TrackBounds | null => {
  const coordinates = track
    .map(toMapCoordinate)
    .filter((coordinate): coordinate is MapCoordinate => coordinate !== null);
  const first = coordinates[0];
  if (!first) return null;

  let minLongitude = first[0];
  let maxLongitude = first[0];
  let minLatitude = first[1];
  let maxLatitude = first[1];

  for (const [longitude, latitude] of coordinates.slice(1)) {
    minLongitude = Math.min(minLongitude, longitude);
    maxLongitude = Math.max(maxLongitude, longitude);
    minLatitude = Math.min(minLatitude, latitude);
    maxLatitude = Math.max(maxLatitude, latitude);
  }

  return [
    [minLongitude, minLatitude],
    [maxLongitude, maxLatitude],
  ];
};
