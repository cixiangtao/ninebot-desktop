import { useState } from "react";
import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "../../src/renderer/src/styles.css";
import { RouteMap } from "../../src/renderer/src/components/RouteMap";
import { VehicleLocationMap } from "../../src/renderer/src/components/VehicleLocationMap";

// Public Berlin coordinates from OpenFreeMap's quick-start example; no account or ride files.
const track = [
  { longitude: 13.388, latitude: 52.517, speed: 12, offsetSeconds: 0 },
  { longitude: 13.39, latitude: 52.518, speed: 20, offsetSeconds: 20 },
];
const MapNetworkFixture = () => {
  const [showLocation, setShowLocation] = useState(false);
  return (
    <main>
      <div style={{ position: "relative", height: 480 }}>
        <RouteMap
          track={track}
          playbackPosition={0}
          coordinateDisplayMode="source"
          onCoordinateDisplayModeChange={() => {}}
        />
      </div>
      <button type="button" onClick={() => setShowLocation(true)}>
        加载公开测试位置
      </button>
      {showLocation ? (
        <div style={{ position: "relative", height: 400 }}>
          <VehicleLocationMap
            location={{ ...track[0]!, locked: true, ignitionOn: false }}
            coordinateDisplayMode="source"
            onCoordinateDisplayModeChange={() => {}}
          />
        </div>
      ) : null}
    </main>
  );
};
const root = document.querySelector("#root");
if (!root) throw new Error("Missing test root");
createRoot(root).render(<MapNetworkFixture />);
