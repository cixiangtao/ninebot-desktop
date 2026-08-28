import type { RideDetail, RideSpeedVerification } from "../shared/contracts.js";

export interface RideSpeedVerificationFailure {
  rideId: string;
  error: unknown;
}

export interface RideSpeedVerificationBatch {
  rides: RideSpeedVerification[];
  failures: RideSpeedVerificationFailure[];
}

const toSpeedVerification = (detail: RideDetail): RideSpeedVerification => ({
  id: detail.id,
  declaredMaxSpeed: detail.declaredMaxSpeed,
  sampledMaxSpeed: detail.sampledMaxSpeed,
});

/**
 * Reads ride details in bounded batches and discards every field except the two speed summaries.
 *
 * The caller decides whether individual failures are recoverable. Results preserve input order
 * among successful rides and never expose the detail track to the renderer-facing contract.
 */
export const loadRideSpeedVerifications = async (
  rideIds: readonly string[],
  loadDetail: (rideId: string) => Promise<RideDetail>,
  concurrency = 3,
): Promise<RideSpeedVerificationBatch> => {
  const batchSize = Math.max(1, Math.floor(concurrency));
  const batches = Array.from({ length: Math.ceil(rideIds.length / batchSize) }, (_, index) =>
    rideIds.slice(index * batchSize, (index + 1) * batchSize),
  );
  const rides: RideSpeedVerification[] = [];
  const failures: RideSpeedVerificationFailure[] = [];

  for (const batch of batches) {
    // Intentionally bounded: each read invokes a separate private upstream request.
    // oxlint-disable-next-line no-await-in-loop
    const settled = await Promise.allSettled(batch.map((rideId) => loadDetail(rideId)));
    for (const [index, result] of settled.entries()) {
      const rideId = batch[index];
      if (!rideId) continue;
      if (result.status === "fulfilled") rides.push(toSpeedVerification(result.value));
      else failures.push({ rideId, error: result.reason });
    }
  }

  return { rides, failures };
};
