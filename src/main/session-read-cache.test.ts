import { describe, expect, it, vi } from "vitest";
import { SessionReadCache } from "./session-read-cache.js";

describe("session read cache", () => {
  it("reuses a fresh value and reloads after its TTL", async () => {
    let now = 1_000;
    const cache = new SessionReadCache<number>(() => now);
    const loader = vi.fn(async () => 42);

    await expect(cache.read("ride", 100, loader)).resolves.toBe(42);
    await expect(cache.read("ride", 100, loader)).resolves.toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);

    now = 1_101;
    await cache.read("ride", 100, loader);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("lets a manual refresh bypass a completed entry", async () => {
    const cache = new SessionReadCache<number>(() => 1_000);
    let value = 1;
    const loader = vi.fn(async () => value);

    await expect(cache.read("snapshot", 10_000, loader)).resolves.toBe(1);
    value = 2;
    await expect(cache.read("snapshot", 10_000, loader, true)).resolves.toBe(2);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("retains the last successful value when a forced refresh fails", async () => {
    const cache = new SessionReadCache<number>(() => 1_000);
    await expect(cache.read("detail", 10_000, async () => 7)).resolves.toBe(7);
    await expect(
      cache.read(
        "detail",
        10_000,
        async () => {
          throw new Error("temporary");
        },
        true,
      ),
    ).rejects.toThrow("temporary");
    await expect(cache.read("detail", 10_000, async () => 9)).resolves.toBe(7);
  });

  it("joins identical concurrent reads", async () => {
    const cache = new SessionReadCache<number>();
    let resolveLoader: ((value: number) => void) | undefined;
    const loader = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveLoader = resolve;
        }),
    );

    const first = cache.read("month", 1_000, loader);
    const second = cache.read("month", 1_000, loader);
    expect(loader).toHaveBeenCalledTimes(1);
    resolveLoader?.(7);
    await expect(Promise.all([first, second])).resolves.toEqual([7, 7]);
  });

  it("does not cache failures or repopulate after clear", async () => {
    const cache = new SessionReadCache<number>();
    await expect(
      cache.read("detail", 1_000, async () => {
        throw new Error("temporary");
      }),
    ).rejects.toThrow("temporary");
    await expect(cache.read("detail", 1_000, async () => 9)).resolves.toBe(9);

    let resolveLoader: ((value: number) => void) | undefined;
    const staleRead = cache.read(
      "pending",
      1_000,
      () =>
        new Promise<number>((resolve) => {
          resolveLoader = resolve;
        }),
    );
    cache.clear();
    resolveLoader?.(3);
    await expect(staleRead).resolves.toBe(3);
    await expect(cache.read("pending", 1_000, async () => 4)).resolves.toBe(4);
  });
});
