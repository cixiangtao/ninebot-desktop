import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import type { TrackPoint } from "../../../shared/contracts";
import { formatDuration } from "../lib/format";
import {
  getKeyboardTrackPosition,
  getTrackInterpolation,
  getTrackPositionFromHorizontalOffset,
  interpolateTrackPoint,
  svgPath,
} from "../lib/track";

interface SpeedChartProps {
  track: TrackPoint[];
  playbackPosition: number;
  onSeek: (position: number) => void;
}

/** Scrubs the shared route playback state through pointer and keyboard interaction. */
export const SpeedChart = ({ track, playbackPosition, onSeek }: SpeedChartProps) => {
  const activePointerId = useRef<number | null>(null);
  const chart = useMemo(() => {
    const maxSpeed = Math.max(80, ...track.map(({ speed }) => speed));
    return track.map((point, index) => ({
      x: track.length <= 1 ? 0 : (index / (track.length - 1)) * 840,
      y: 104 - (point.speed / maxSpeed) * 88,
    }));
  }, [track]);
  const path = svgPath(chart);
  const interpolation = getTrackInterpolation(chart.length, playbackPosition);
  const from = interpolation ? chart[interpolation.fromIndex] : null;
  const to = interpolation ? chart[interpolation.toIndex] : null;
  const active =
    interpolation && from && to
      ? {
          x: from.x + (to.x - from.x) * interpolation.ratio,
          y: from.y + (to.y - from.y) * interpolation.ratio,
        }
      : null;
  const activePoint = interpolateTrackPoint(track, playbackPosition);
  const lastPoint = track.at(-1);

  const seekFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    onSeek(
      getTrackPositionFromHorizontalOffset(event.clientX - bounds.left, bounds.width, track.length),
    );
  };

  const startPointerSeek = (event: PointerEvent<HTMLDivElement>) => {
    if (track.length <= 1) return;
    activePointerId.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromPointer(event);
  };

  const movePointerSeek = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== event.pointerId) return;
    seekFromPointer(event);
  };

  const finishPointerSeek = (event: PointerEvent<HTMLDivElement>) => {
    if (activePointerId.current !== event.pointerId) return;
    activePointerId.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const navigateByKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const nextPosition = getKeyboardTrackPosition(
      playbackPosition,
      event.key,
      event.shiftKey,
      track.length,
    );
    if (nextPosition === null) return;
    event.preventDefault();
    onSeek(nextPosition);
  };

  return (
    <div
      className="speed-chart relative h-[118px] min-w-0 flex-1"
      role="slider"
      tabIndex={track.length > 1 ? 0 : -1}
      aria-label="速度曲线定位"
      aria-valuemin={0}
      aria-valuemax={Math.round(lastPoint?.offsetSeconds ?? 0)}
      aria-valuenow={Math.round(activePoint?.offsetSeconds ?? 0)}
      aria-valuetext={`${formatDuration(activePoint?.offsetSeconds ?? 0)}，${Math.round(activePoint?.speed ?? 0)} km/h`}
      aria-disabled={track.length <= 1}
      onPointerDown={startPointerSeek}
      onPointerMove={movePointerSeek}
      onPointerUp={finishPointerSeek}
      onPointerCancel={finishPointerSeek}
      onLostPointerCapture={() => {
        activePointerId.current = null;
      }}
      onKeyDown={navigateByKeyboard}
    >
      <svg
        viewBox="0 0 840 118"
        preserveAspectRatio="none"
        className="pointer-events-none h-full w-full overflow-visible"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="speed-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#12c7b5" stopOpacity="0.26" />
            <stop offset="1" stopColor="#12c7b5" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[16, 60, 104].map((y) => (
          <line key={y} x1="0" y1={y} x2="840" y2={y} stroke="#d8e0e4" strokeDasharray="3 5" />
        ))}
        {path ? <path d={`${path} L840 104 L0 104 Z`} fill="url(#speed-fill)" /> : null}
        {path ? (
          <path
            d={path}
            fill="none"
            stroke="#11bfae"
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {active ? (
          <>
            <line
              x1={active.x}
              y1="6"
              x2={active.x}
              y2="104"
              stroke="#0fae9f"
              strokeDasharray="3 4"
            />
            <circle
              cx={active.x}
              cy={active.y}
              r="7"
              fill="#ffffff"
              stroke="#10bfae"
              strokeWidth="4"
            />
          </>
        ) : null}
      </svg>
    </div>
  );
};
