import { Crosshair, LoaderCircle, RotateCcw, WifiOff } from "lucide-react";
import {
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  type Map as MapLibreMapInstance,
} from "maplibre-gl";
import mapLibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useMemo, useRef, useState } from "react";
import type { VehicleLocation } from "../../../shared/contracts";
import {
  getCoordinatePreviewShiftMeters,
  resolveMapCoordinate,
  type CoordinateDisplayMode,
} from "../lib/coordinate";
import type { MapCoordinate } from "../lib/track";
import { CoordinatePreviewControl } from "./CoordinatePreviewControl";

interface VehicleLocationMapProps {
  location: VehicleLocation;
  coordinateDisplayMode: CoordinateDisplayMode;
  onCoordinateDisplayModeChange: (mode: CoordinateDisplayMode) => void;
}

type MapStatus = "loading" | "ready" | "fallback";

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const MAP_LOAD_TIMEOUT_MS = 10_000;

setWorkerUrl(mapLibreWorkerUrl);

const createVehicleMarker = () => {
  const element = document.createElement("div");
  const core = document.createElement("span");
  element.className = "vehicle-location-marker";
  core.className = "vehicle-location-marker-core";
  element.append(core);
  element.setAttribute("aria-hidden", "true");
  return element;
};

/** Loads third-party map tiles only after its parent has received explicit user consent. */
export const VehicleLocationMap = ({
  location,
  coordinateDisplayMode,
  onCoordinateDisplayModeChange,
}: VehicleLocationMapProps) => {
  const [mapStatus, setMapStatus] = useState<MapStatus>("loading");
  const [retryKey, setRetryKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMapInstance | null>(null);
  const coordinate = useMemo<MapCoordinate>(
    () =>
      resolveMapCoordinate(location, coordinateDisplayMode) ?? [
        location.longitude,
        location.latitude,
      ],
    [coordinateDisplayMode, location],
  );
  const previewShiftMeters = getCoordinatePreviewShiftMeters(location);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setMapStatus("loading");
    let disposed = false;
    let removed = false;
    let styleLoaded = false;
    const map = new MapLibreMap({
      container,
      style: MAP_STYLE_URL,
      center: coordinate,
      zoom: 16,
      maxPitch: 0,
      dragRotate: false,
      attributionControl: { compact: true },
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    const loadTimeout = window.setTimeout(() => {
      if (styleLoaded || disposed) return;
      removed = true;
      map.remove();
      mapRef.current = null;
      setMapStatus("fallback");
    }, MAP_LOAD_TIMEOUT_MS);

    map.on("style.load", () => {
      if (disposed) return;
      styleLoaded = true;
      window.clearTimeout(loadTimeout);
      new Marker({ element: createVehicleMarker(), anchor: "center" })
        .setLngLat(coordinate)
        .addTo(map);
      setMapStatus("ready");
    });

    return () => {
      disposed = true;
      window.clearTimeout(loadTimeout);
      mapRef.current = null;
      if (!removed) map.remove();
    };
    // retryKey intentionally recreates a failed map instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coordinate, retryKey]);

  const recenter = () => {
    mapRef.current?.easeTo({ center: coordinate, zoom: 16, duration: 520 });
  };

  return (
    <div className="vehicle-location-map" aria-label="车辆位置地图">
      <div className="vehicle-location-fallback" aria-hidden="true">
        <i />
        <span />
      </div>
      <div
        ref={containerRef}
        className={`vehicle-location-online ${mapStatus === "ready" ? "vehicle-location-online-ready" : ""}`}
        role="img"
        aria-label={`OpenFreeMap WGS84 在线底图上的车辆位置，${coordinateDisplayMode === "source" ? "当前使用接口原值" : "当前使用GCJ-02转WGS84校准预览"}`}
      />

      {mapStatus === "loading" ? (
        <span className="location-map-note" role="status">
          <LoaderCircle size={13} className="animate-spin" />
          正在加载在线底图
        </span>
      ) : null}
      {mapStatus === "fallback" ? (
        <div className="location-map-fallback-note" role="status">
          <WifiOff size={14} />
          <span>在线底图不可用，位置坐标未发送给其他服务</span>
          <button type="button" onClick={() => setRetryKey((key) => key + 1)}>
            <RotateCcw size={13} />
            重试
          </button>
        </div>
      ) : null}
      {mapStatus === "ready" ? (
        <>
          {previewShiftMeters !== null ? (
            <CoordinatePreviewControl
              mode={coordinateDisplayMode}
              shiftMeters={previewShiftMeters}
              surface="location"
              onChange={onCoordinateDisplayModeChange}
            />
          ) : null}
          <button
            className="location-recenter-button"
            type="button"
            onClick={recenter}
            aria-label="回到车辆位置"
          >
            <Crosshair size={19} />
          </button>
          <span className="location-map-provider-note">
            在线底图 · WGS84 · OpenFreeMap 可推断当前位置区域
          </span>
        </>
      ) : null}
    </div>
  );
};
