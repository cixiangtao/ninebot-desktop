import { useMemo } from "react";
import type { TrackPoint } from "../../../shared/contracts";
import { getSpeedZoneIndex, summarizeTrackSpeedZones } from "../lib/track";

interface SpeedZoneDistributionProps {
  track: TrackPoint[];
  activeSpeed: number;
  onSeek: (position: number) => void;
}

/** Shows distance share by speed and seeks to the fastest segment in a selected zone. */
export const SpeedZoneDistribution = ({
  track,
  activeSpeed,
  onSeek,
}: SpeedZoneDistributionProps) => {
  const zones = useMemo(() => summarizeTrackSpeedZones(track), [track]);
  const activeZoneIndex = getSpeedZoneIndex(activeSpeed);

  return (
    <div className="speed-zone-distribution" aria-label="轨迹速度区间">
      <span className="speed-zone-heading">轨迹里程占比</span>
      <div className="speed-zone-content">
        <div className="speed-zone-stack" aria-hidden="true">
          {zones.map((zone) => (
            <span
              key={zone.minimumSpeed}
              style={{ backgroundColor: zone.color, flexGrow: zone.distanceKm }}
            />
          ))}
        </div>
        <div className="speed-zone-options">
          {zones.map((zone, index) => {
            const percentage = Math.round(zone.distanceShare * 100);
            const disabled = zone.peakPosition === null;
            return (
              <button
                key={zone.minimumSpeed}
                className={index === activeZoneIndex ? "speed-zone-option-active" : undefined}
                type="button"
                disabled={disabled}
                aria-pressed={!disabled && index === activeZoneIndex}
                aria-label={`定位到 ${zone.label} km/h 区间最快点，轨迹里程 ${zone.distanceKm.toFixed(2)} km，占比 ${percentage}%`}
                title={`${zone.distanceKm.toFixed(2)} km`}
                onClick={() => {
                  if (zone.peakPosition !== null) onSeek(zone.peakPosition);
                }}
              >
                <i style={{ backgroundColor: zone.color }} aria-hidden="true" />
                <span>{zone.label}</span>
                <strong>{percentage}%</strong>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
