/** A track peak is the maximum returned speed sample, never an upstream summary fallback. */
export const resolveTrackPeakSpeed = (sampledMaxSpeed: number | null): number | null =>
  sampledMaxSpeed !== null && Number.isFinite(sampledMaxSpeed) && sampledMaxSpeed >= 0
    ? sampledMaxSpeed
    : null;
