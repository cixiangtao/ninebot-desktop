import gcoord from "gcoord";
import type { TrackPoint } from "../../../shared/contracts";
import type { MapCoordinate } from "./track";

export type CoordinateDisplayMode = "source" | "gcj02-to-wgs84-preview";

interface GeographicCoordinate {
  longitude: number;
  latitude: number;
}

const CHINA_LONGITUDE_RANGE = [72.004, 137.8347] as const;
const CHINA_LATITUDE_RANGE = [0.8293, 55.8271] as const;
const EARTH_RADIUS_METERS = 6_371_008.8;

const isValidCoordinate = ({ longitude, latitude }: GeographicCoordinate) =>
  Number.isFinite(longitude) &&
  Number.isFinite(latitude) &&
  longitude >= -180 &&
  longitude <= 180 &&
  latitude >= -90 &&
  latitude <= 90;

/** Returns whether the local GCJ-02 comparison is meaningful for this coordinate. */
export const isCoordinatePreviewAvailable = (coordinate: GeographicCoordinate) =>
  isValidCoordinate(coordinate) &&
  coordinate.longitude >= CHINA_LONGITUDE_RANGE[0] &&
  coordinate.longitude <= CHINA_LONGITUDE_RANGE[1] &&
  coordinate.latitude >= CHINA_LATITUDE_RANGE[0] &&
  coordinate.latitude <= CHINA_LATITUDE_RANGE[1];

/**
 * Resolves a map-only coordinate without mutating Ninebot's source value.
 *
 * The preview mode is diagnostic: it tests the hypothesis that an upstream point is GCJ-02
 * before placing the copied point on MapLibre's WGS84 map. It does not establish the source CRS.
 */
export const resolveMapCoordinate = (
  coordinate: GeographicCoordinate,
  mode: CoordinateDisplayMode,
): MapCoordinate | null => {
  if (!isValidCoordinate(coordinate)) return null;
  const source: MapCoordinate = [coordinate.longitude, coordinate.latitude];
  if (mode === "source" || !isCoordinatePreviewAvailable(coordinate)) return source;
  return gcoord.transform(source, gcoord.GCJ02, gcoord.WGS84);
};

/** Creates a display-only trail copy while preserving speed and playback metadata. */
export const createMapDisplayTrack = (
  track: TrackPoint[],
  mode: CoordinateDisplayMode,
): TrackPoint[] => {
  if (mode === "source") return track;
  return track.map((point) => {
    const coordinate = resolveMapCoordinate(point, mode);
    return coordinate ? { ...point, longitude: coordinate[0], latitude: coordinate[1] } : point;
  });
};

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Calculates the local preview displacement for one source point, in meters. */
export const getCoordinatePreviewShiftMeters = (coordinate: GeographicCoordinate) => {
  if (!isCoordinatePreviewAvailable(coordinate)) return null;
  const preview = resolveMapCoordinate(coordinate, "gcj02-to-wgs84-preview");
  if (!preview) return null;
  const sourceLongitude = toRadians(coordinate.longitude);
  const sourceLatitude = toRadians(coordinate.latitude);
  const previewLongitude = toRadians(preview[0]);
  const previewLatitude = toRadians(preview[1]);
  const latitudeDelta = previewLatitude - sourceLatitude;
  const longitudeDelta = previewLongitude - sourceLongitude;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(sourceLatitude) * Math.cos(previewLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return (
    EARTH_RADIUS_METERS *
    2 *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)))
  );
};
