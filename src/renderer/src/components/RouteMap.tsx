import { Crosshair, Layers3, LoaderCircle, RotateCcw, WifiOff } from "lucide-react";
import {
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  type AddLayerObject,
  type Map as MapLibreMapInstance,
} from "maplibre-gl";
import mapLibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TrackPoint } from "../../../shared/contracts";
import {
  createMapDisplayTrack,
  getCoordinatePreviewShiftMeters,
  type CoordinateDisplayMode,
} from "../lib/coordinate";
import {
  createRouteData,
  getSpeedColor,
  getTrackInterpolation,
  getTrackBounds,
  interpolateTrackPoint,
  projectTrack,
  speedColorStops,
  svgPath,
  toMapCoordinate,
  type TrackBounds,
} from "../lib/track";
import { CoordinatePreviewControl } from "./CoordinatePreviewControl";

interface RouteMapProps {
  track: TrackPoint[];
  playbackPosition: number;
  coordinateDisplayMode: CoordinateDisplayMode;
  onCoordinateDisplayModeChange: (mode: CoordinateDisplayMode) => void;
}

type MapStatus = "loading" | "ready" | "fallback";

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const MAP_LOAD_TIMEOUT_MS = 10_000;
const ROUTE_SOURCE_ID = "ride-route";
const ROUTE_CASING_LAYER_ID = "ride-route-casing";
const ROUTE_LAYER_ID = "ride-route-line";
type LinePaint = NonNullable<Extract<AddLayerObject, { type: "line" }>["paint"]>;
const routeSpeedColorExpression: NonNullable<LinePaint["line-color"]> = [
  "step",
  ["get", "speed"],
  speedColorStops[0].color,
  ...speedColorStops.slice(1).flatMap(({ minimumSpeed, color }) => [minimumSpeed, color]),
];

setWorkerUrl(mapLibreWorkerUrl);

const roads = [
  "M-80 118 C190 58 350 145 1060 72",
  "M-30 226 C285 180 650 250 1080 198",
  "M-50 390 C180 334 540 430 1080 350",
  "M-40 548 C320 492 655 570 1090 492",
  "M124 -40 C166 162 130 448 210 760",
  "M355 -40 C310 226 400 500 344 760",
  "M622 -40 C570 220 674 464 648 760",
  "M830 -40 C892 224 804 510 884 760",
];

const fitRoute = (map: MapLibreMapInstance, bounds: TrackBounds, animated: boolean) => {
  const [[west, south], [east, north]] = bounds;
  if (west === east && south === north) {
    map.easeTo({ center: [west, south], zoom: 16, duration: animated ? 520 : 0 });
    return;
  }

  const { clientHeight, clientWidth } = map.getContainer();
  map.fitBounds(bounds, {
    padding: {
      top: 72,
      right: Math.min(340, Math.round(clientWidth * 0.28)),
      bottom: Math.min(230, Math.round(clientHeight * 0.3)),
      left: 56,
    },
    maxZoom: 16,
    duration: animated ? 620 : 0,
  });
};

const setMapLabelsVisible = (map: MapLibreMapInstance, visible: boolean) => {
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.type === "symbol") {
      map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
    }
  }
};

const createEndpointElement = (label: string, tone: "start" | "end") => {
  const element = document.createElement("div");
  const text = document.createElement("span");
  element.className = `map-endpoint map-endpoint-${tone}`;
  text.textContent = label;
  element.append(text);
  element.setAttribute("aria-hidden", "true");
  return element;
};

const createPlaybackElement = () => {
  const element = document.createElement("div");
  element.className = "map-playback-marker";
  element.setAttribute("aria-hidden", "true");
  return element;
};

/** Displays an interactive online map with a local SVG fallback. */
export const RouteMap = ({
  track,
  playbackPosition,
  coordinateDisplayMode,
  onCoordinateDisplayModeChange,
}: RouteMapProps) => {
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [mapStatus, setMapStatus] = useState<MapStatus>("loading");
  const [retryKey, setRetryKey] = useState(0);
  const [fallbackPulse, setFallbackPulse] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMapInstance | null>(null);
  const activeMarkerRef = useRef<Marker | null>(null);
  const pulseTimeoutRef = useRef<number | null>(null);
  const displayTrack = useMemo(
    () => createMapDisplayTrack(track, coordinateDisplayMode),
    [coordinateDisplayMode, track],
  );
  const routeData = useMemo(() => createRouteData(displayTrack), [displayTrack]);
  const bounds = useMemo(() => getTrackBounds(displayTrack), [displayTrack]);
  const startCoordinate = useMemo(
    () => (displayTrack[0] ? toMapCoordinate(displayTrack[0]) : null),
    [displayTrack],
  );
  const endCoordinate = useMemo(() => {
    const endPoint = displayTrack.at(-1);
    return endPoint ? toMapCoordinate(endPoint) : null;
  }, [displayTrack]);
  const activePoint = interpolateTrackPoint(displayTrack, playbackPosition);
  const activeCoordinate = activePoint ? toMapCoordinate(activePoint) : null;
  const previewAnchor = track[Math.floor(track.length / 2)];
  const previewShiftMeters = previewAnchor ? getCoordinatePreviewShiftMeters(previewAnchor) : null;
  const latestActiveCoordinateRef = useRef(activeCoordinate);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !bounds || !startCoordinate || !endCoordinate) {
      setMapStatus("fallback");
      return;
    }

    setMapStatus("loading");
    let disposed = false;
    let removed = false;
    let styleLoaded = false;
    const map = new MapLibreMap({
      container,
      style: MAP_STYLE_URL,
      center: startCoordinate,
      zoom: 14,
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
      activeMarkerRef.current = null;
      setMapStatus("fallback");
    }, MAP_LOAD_TIMEOUT_MS);

    map.on("style.load", () => {
      if (disposed) return;
      styleLoaded = true;
      window.clearTimeout(loadTimeout);
      map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: routeData });
      map.addLayer({
        id: ROUTE_CASING_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-opacity": 0.96, "line-width": 12 },
      });
      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": routeSpeedColorExpression, "line-width": 7 },
      });

      new Marker({ element: createEndpointElement("起", "start"), anchor: "bottom" })
        .setLngLat(startCoordinate)
        .addTo(map);
      new Marker({ element: createEndpointElement("终", "end"), anchor: "bottom" })
        .setLngLat(endCoordinate)
        .addTo(map);
      const playbackMarker = new Marker({ element: createPlaybackElement(), anchor: "center" })
        .setLngLat(latestActiveCoordinateRef.current ?? startCoordinate)
        .addTo(map);
      activeMarkerRef.current = playbackMarker;

      fitRoute(map, bounds, false);
      setMapStatus("ready");
    });

    return () => {
      disposed = true;
      window.clearTimeout(loadTimeout);
      if (pulseTimeoutRef.current !== null) window.clearTimeout(pulseTimeoutRef.current);
      activeMarkerRef.current = null;
      mapRef.current = null;
      if (!removed) map.remove();
    };
    // retryKey intentionally tears down and recreates a failed map instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, endCoordinate, retryKey, routeData, startCoordinate]);

  useEffect(() => {
    latestActiveCoordinateRef.current = activeCoordinate;
    if (activeCoordinate) activeMarkerRef.current?.setLngLat(activeCoordinate);
  }, [activeCoordinate]);

  useEffect(() => {
    const map = mapRef.current;
    if (mapStatus === "ready" && map) setMapLabelsVisible(map, labelsVisible);
  }, [labelsVisible, mapStatus]);

  const focusRoute = () => {
    const map = mapRef.current;
    if (mapStatus === "ready" && map && bounds) {
      fitRoute(map, bounds, true);
      map.setPaintProperty(ROUTE_LAYER_ID, "line-width", 12);
      if (pulseTimeoutRef.current !== null) window.clearTimeout(pulseTimeoutRef.current);
      pulseTimeoutRef.current = window.setTimeout(() => {
        if (mapRef.current?.getLayer(ROUTE_LAYER_ID)) {
          mapRef.current.setPaintProperty(ROUTE_LAYER_ID, "line-width", 7);
        }
      }, 760);
      return;
    }

    setFallbackPulse(false);
    requestAnimationFrame(() => setFallbackPulse(true));
    window.setTimeout(() => setFallbackPulse(false), 800);
  };

  return (
    <div className="route-map" aria-label="轨迹回放地图">
      <RouteFallbackCanvas
        track={track}
        playbackPosition={playbackPosition}
        labelsVisible={labelsVisible}
        routePulse={fallbackPulse}
      />
      <div
        ref={containerRef}
        className={`online-map ${mapStatus === "ready" ? "online-map-ready" : ""}`}
        role="img"
        aria-label={`OpenFreeMap WGS84 在线底图上的骑行轨迹，${coordinateDisplayMode === "source" ? "当前使用接口原值" : "当前使用GCJ-02转WGS84校准预览"}`}
      />

      {track.length > 0 && mapStatus === "loading" ? (
        <span className="map-loading-note" role="status">
          <LoaderCircle size={13} className="animate-spin" />
          正在载入在线底图
        </span>
      ) : null}
      {track.length > 0 && mapStatus === "fallback" ? (
        <div className="map-fallback-note" role="status">
          <WifiOff size={14} />
          <span>在线底图不可用，已保留本地轨迹</span>
          <button type="button" onClick={() => setRetryKey((key) => key + 1)}>
            <RotateCcw size={13} />
            重试
          </button>
        </div>
      ) : null}

      {track.length > 0 ? <SpeedLegend loading={mapStatus === "loading"} /> : null}

      {track.length > 0 ? (
        <div className="map-controls">
          <button
            className={`map-control ${labelsVisible ? "map-control-active" : ""}`}
            type="button"
            aria-label={labelsVisible ? "隐藏地图标注" : "显示地图标注"}
            aria-pressed={labelsVisible}
            onClick={() => setLabelsVisible((visible) => !visible)}
          >
            <Layers3 size={19} />
          </button>
          <button
            className="map-control"
            type="button"
            aria-label="显示完整轨迹"
            onClick={focusRoute}
          >
            <Crosshair size={19} />
          </button>
        </div>
      ) : null}

      {track.length > 0 && mapStatus === "ready" && previewShiftMeters !== null ? (
        <CoordinatePreviewControl
          mode={coordinateDisplayMode}
          shiftMeters={previewShiftMeters}
          surface="route"
          onChange={onCoordinateDisplayModeChange}
        />
      ) : null}

      {track.length > 0 && mapStatus === "ready" ? (
        <span
          className="map-provider-note"
          title="底图服务会收到当前视野对应的瓦片请求；完整轨迹不会作为接口参数上传。"
        >
          在线底图 · WGS84 · 位置区域会请求第三方瓦片
        </span>
      ) : null}
    </div>
  );
};

interface RouteFallbackCanvasProps {
  track: TrackPoint[];
  playbackPosition: number;
  labelsVisible: boolean;
  routePulse: boolean;
}

const RouteFallbackCanvas = ({
  track,
  playbackPosition,
  labelsVisible,
  routePulse,
}: RouteFallbackCanvasProps) => {
  const points = useMemo(() => projectTrack(track, 1000, 700, 118), [track]);
  const route = svgPath(points);
  const routeSegments = points.slice(0, -1).flatMap((from, index) => {
    const to = points[index + 1];
    if (!to) return [];
    return [{ from, to, speed: (from.speed + to.speed) / 2, index }];
  });
  const interpolation = getTrackInterpolation(points.length, playbackPosition);
  const from = interpolation ? points[interpolation.fromIndex] : null;
  const to = interpolation ? points[interpolation.toIndex] : null;
  const activePoint =
    interpolation && from && to
      ? {
          x: from.x + (to.x - from.x) * interpolation.ratio,
          y: from.y + (to.y - from.y) * interpolation.ratio,
        }
      : null;
  const start = points[0];
  const end = points.at(-1);

  return (
    <svg
      viewBox="0 0 1000 700"
      className="route-fallback-canvas"
      role="img"
      aria-label="本地骑行轨迹画布"
    >
      <defs>
        <filter id="route-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#0a8e84" floodOpacity="0.24" />
        </filter>
      </defs>
      <rect width="1000" height="700" fill="#edf2f3" />
      <path
        d="M-20 590 C200 520 315 600 520 560 C740 515 840 630 1030 590 L1030 730 L-20 730Z"
        fill="#dcebed"
      />
      <path
        d="M-30 618 C240 530 330 634 536 582 C758 526 846 650 1030 606"
        fill="none"
        stroke="#b9dadd"
        strokeWidth="18"
      />
      <rect x="690" y="72" width="180" height="122" rx="32" fill="#dcebdc" />
      <rect x="92" y="332" width="150" height="96" rx="28" fill="#dfece0" />
      {roads.map((road) => (
        <g key={road}>
          <path d={road} fill="none" stroke="#ffffff" strokeWidth="24" strokeLinecap="round" />
          <path d={road} fill="none" stroke="#d4dce0" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      ))}
      {labelsVisible ? (
        <g className="map-labels" fill="#8a969f" fontSize="16" fontWeight="560">
          <text x="104" y="310">
            河畔路
          </text>
          <text x="720" y="138">
            城市公园
          </text>
          <text x="440" y="184">
            北环路
          </text>
          <text x="752" y="452">
            新城街
          </text>
          <text x="300" y="518">
            中央大道
          </text>
        </g>
      ) : null}
      {route ? (
        <path
          d={route}
          fill="none"
          stroke="#ffffff"
          strokeWidth="18"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      <g filter="url(#route-shadow)">
        {routeSegments.map(({ from: segmentStart, to: segmentEnd, speed, index }) => (
          <line
            key={index}
            x1={segmentStart.x}
            y1={segmentStart.y}
            x2={segmentEnd.x}
            y2={segmentEnd.y}
            stroke={getSpeedColor(speed)}
            strokeWidth="10"
            strokeLinecap="round"
            className={routePulse ? "route-pulse" : undefined}
          />
        ))}
      </g>
      {start ? <MapPin x={start.x} y={start.y} label="起" tone="#10bda9" /> : null}
      {end ? <MapPin x={end.x} y={end.y} label="终" tone="#ff5b62" /> : null}
      {activePoint ? (
        <g transform={`translate(${activePoint.x} ${activePoint.y})`} className="route-marker">
          <circle r="19" fill="#ffffff" opacity="0.96" />
          <circle r="11" fill="#18232f" />
          <path
            d="M-4 2 L0 -6 L4 2 M-5 5 H5"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </g>
      ) : null}
    </svg>
  );
};

const SpeedLegend = ({ loading }: { loading: boolean }) => (
  <div
    className={`map-speed-legend ${loading ? "map-speed-legend-loading" : ""}`}
    role="img"
    aria-label="轨迹速度颜色图例：蓝色为低速，红色为高速"
  >
    <div>
      <strong>轨迹速度</strong>
      <small>km/h</small>
    </div>
    <i />
    <ol>
      {speedColorStops.map(({ minimumSpeed }) => (
        <li key={minimumSpeed}>{minimumSpeed === 60 ? "60+" : minimumSpeed}</li>
      ))}
    </ol>
  </div>
);

interface MapPinProps {
  x: number;
  y: number;
  label: string;
  tone: string;
}

const MapPin = ({ x, y, label, tone }: MapPinProps) => (
  <g transform={`translate(${x} ${y})`}>
    <path
      d="M0 20 C-17 2 -22 -8 -22 -20 C-22 -34 -12 -44 0 -44 C12 -44 22 -34 22 -20 C22 -8 17 2 0 20Z"
      fill={tone}
    />
    <circle cy="-20" r="13" fill="#ffffff" />
    <text y="-15" textAnchor="middle" fill={tone} fontSize="14" fontWeight="760">
      {label}
    </text>
  </g>
);
