import { describe, expect, it, vi } from "vitest";
import type { RideSpeedVerification } from "../../../shared/contracts";
import { RidePeakQueue } from "./ride-peak-queue";

const reading = (id: string, sampledMaxSpeed: number | null = 37): RideSpeedVerification => ({
  id,
  declaredMaxSpeed: 41,
  sampledMaxSpeed,
});
const flush = async () => {
  // Drain chained promises without introducing timer or wall-clock dependencies.
  for (let i = 0; i < 8; i += 1) {
    // oxlint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
};
const fixture = () => {
  const pending = new Map<
    string,
    {
      resolve: (value: RideSpeedVerification) => void;
      reject: (cause: Error) => void;
    }
  >();
  const load = vi.fn(
    (id: string) =>
      new Promise<RideSpeedVerification>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      }),
  );
  const onRead = vi.fn();
  const onState = vi.fn();
  const queue = new RidePeakQueue(onRead, onState);
  return { queue, load, pending, onRead, onState };
};

describe("viewport track-peak queue", () => {
  it("reads without a click, limits concurrency to two and publishes each completed result", async () => {
    const { queue, load, pending, onRead } = fixture();
    queue.update(["a", "b", "c"], {}, load);
    await flush();
    expect(load.mock.calls).toEqual([["a"], ["b"]]);
    pending.get("b")!.resolve(reading("b"));
    await flush();
    expect(onRead).toHaveBeenCalledExactlyOnceWith(reading("b"));
    expect(load.mock.calls).toEqual([["a"], ["b"], ["c"]]);
  });

  it("drops unstarted offscreen work and prioritizes the new viewport", async () => {
    const { queue, load, pending } = fixture();
    queue.update(["a", "b", "c", "d"], {}, load);
    await flush();
    queue.update(["x", "y"], {}, load);
    pending.get("a")!.resolve(reading("a"));
    await flush();
    expect(load.mock.calls).toEqual([["a"], ["b"], ["x"]]);
  });

  it("reuses known empty and zero results and retries failures only on request", async () => {
    const { queue, load, pending, onState } = fixture();
    const known = { empty: reading("empty", null), zero: reading("zero", 0) };
    queue.update(["empty", "zero", "bad"], known, load);
    await flush();
    pending.get("bad")!.reject(new Error("offline"));
    await flush();
    queue.update(["bad", "empty"], known, load);
    await flush();
    expect(load.mock.calls).toEqual([["bad"]]);
    expect(onState).toHaveBeenLastCalledWith({ loading: false, failedCount: 1, error: "offline" });
    queue.requestAll(["empty", "zero", "bad"]);
    await flush();
    expect(load.mock.calls).toEqual([["bad"], ["bad"]]);
  });

  it("keeps old in-flight reads within the limit and discards their results after switching scope", async () => {
    const { queue, load, pending, onRead } = fixture();
    queue.update(["a", "b", "c"], {}, load);
    await flush();
    queue.reset();
    queue.update(["x", "y", "z"], {}, load);
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    pending.get("a")!.resolve(reading("a"));
    await flush();
    expect(onRead).not.toHaveBeenCalled();
    expect(load.mock.calls).toEqual([["a"], ["b"], ["x"]]);
    pending.get("x")!.resolve(reading("x"));
    await flush();
    expect(onRead).toHaveBeenCalledExactlyOnceWith(reading("x"));
  });

  it("shares manual completion with automatic work without duplicates, and pauses when hidden", async () => {
    const { queue, load, pending } = fixture();
    queue.update(["a", "b"], {}, load);
    queue.requestAll(["a", "b", "c"]);
    await flush();
    queue.update([], {}, null);
    pending.get("a")!.resolve(reading("a"));
    pending.get("b")!.resolve(reading("b"));
    await flush();
    expect(load.mock.calls).toEqual([["a"], ["b"]]);
    queue.update([], {}, load);
    await flush();
    expect(load.mock.calls).toEqual([["a"], ["b"], ["c"]]);
  });
});
