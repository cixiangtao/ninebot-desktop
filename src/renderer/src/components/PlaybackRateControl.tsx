import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { playbackRates, type PlaybackRate } from "../lib/track";

interface PlaybackRateControlProps {
  value: PlaybackRate;
  disabled: boolean;
  onChange: (rate: PlaybackRate) => void;
}

const formatRate = (rate: PlaybackRate) => `${rate}×`;

/** Provides an accessible popup for selecting the continuous route playback rate. */
export const PlaybackRateControl = ({ value, disabled, onChange }: PlaybackRateControlProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  return (
    <div className="playback-rate-control" ref={containerRef}>
      <button
        type="button"
        aria-label={`回放速度 ${value} 倍`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((visible) => !visible)}
        disabled={disabled}
      >
        {formatRate(value)}
        <ChevronDown size={12} />
      </button>
      {open ? (
        <div className="playback-rate-menu" role="listbox" aria-label="选择回放速度">
          {playbackRates.map((rate) => (
            <button
              type="button"
              role="option"
              aria-selected={rate === value}
              key={rate}
              onClick={() => {
                onChange(rate);
                setOpen(false);
              }}
            >
              <span>{formatRate(rate)}</span>
              {rate === value ? <Check size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
