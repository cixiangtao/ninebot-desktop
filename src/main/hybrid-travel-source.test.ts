import { describe, expect, it, vi } from "vitest";
import { createHybridTravelReader } from "./hybrid-travel-source.js";

const payload = (count: number, rows: unknown[]) => ({
  code: 0,
  data: { times: count, total_mileages: 10, duration: 60, list: rows },
});

describe("createHybridTravelReader", () => {
  it("uses the paginated bridge only when ninecli reports more rows", async () => {
    const ninecli = {
      rides: vi.fn().mockResolvedValue(
        payload(
          25,
          Array.from({ length: 20 }, (_, i) => ({ id: String(i) })),
        ),
      ),
      rideDetail: vi.fn(),
    };
    const paginated = {
      rides: vi.fn().mockResolvedValue(
        payload(
          25,
          Array.from({ length: 25 }, (_, i) => ({ id: String(i) })),
        ),
      ),
      rideDetail: vi.fn(),
    };
    const refreshSession = vi.fn().mockResolvedValue({ connected: true });
    const reader = createHybridTravelReader({ ninecli, paginated, refreshSession });

    await expect(reader.rides("SN", "202609")).resolves.toEqual(
      expect.objectContaining({ data: expect.objectContaining({ times: 25 }) }),
    );
    expect(ninecli.rides).toHaveBeenCalledWith("SN", "202609");
    expect(paginated.rides).toHaveBeenCalledWith("SN", "202609");
    expect(refreshSession).toHaveBeenCalledOnce();
  });

  it("keeps ninecli for complete months and ride details", async () => {
    const ninecli = {
      rides: vi.fn().mockResolvedValue(payload(2, [{ id: "1" }, { id: "2" }])),
      rideDetail: vi.fn().mockResolvedValue({ ok: true }),
    };
    const paginated = { rides: vi.fn(), rideDetail: vi.fn() };
    const reader = createHybridTravelReader({ ninecli, paginated });

    await reader.rides("SN", "202609");
    await reader.rideDetail("SN", "ride-1");
    expect(paginated.rides).not.toHaveBeenCalled();
    expect(ninecli.rideDetail).toHaveBeenCalledWith("SN", "ride-1");
  });

  it.each(["missing", "duplicate", "failure"])(
    "rejects %s pages without falling back to partial rows",
    async (mode) => {
      const ninecli = {
        rides: vi.fn().mockResolvedValue(payload(3, [{ id: "1" }])),
        rideDetail: vi.fn(),
      };
      const paginated = {
        rides:
          mode === "failure"
            ? vi.fn().mockRejectedValue(new Error("private upstream payload"))
            : vi
                .fn()
                .mockResolvedValue(
                  payload(
                    3,
                    mode === "missing" ? [{ id: "1" }] : [{ id: "1" }, { id: "1" }, { id: "2" }],
                  ),
                ),
        rideDetail: vi.fn(),
      };
      await expect(
        createHybridTravelReader({ ninecli, paginated }).rides("SN", "202609"),
      ).rejects.toMatchObject({ kind: "upstream" });
    },
  );

  it("does not start pagination after the session has been cleared", async () => {
    let resolveFirst!: (value: unknown) => void;
    const ninecli = {
      rides: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      ),
      rideDetail: vi.fn(),
      clear: vi.fn(),
    };
    const paginated = { rides: vi.fn(), rideDetail: vi.fn(), clear: vi.fn() };
    const reader = createHybridTravelReader({ ninecli, paginated });
    const pending = reader.rides("SN", "202609");
    reader.clear?.();
    resolveFirst(payload(3, [{ id: "1" }]));
    await expect(pending).rejects.toThrow("月份读取已取消");
    expect(paginated.rides).not.toHaveBeenCalled();
    expect(ninecli.clear).toHaveBeenCalledOnce();
    expect(paginated.clear).toHaveBeenCalledOnce();
  });
});
