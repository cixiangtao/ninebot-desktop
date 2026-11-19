import { describe, expect, it, vi } from "vitest";
import {
  createNinebotCandidateSessionClientFromClients,
  type CandidateTravelSessionClient,
} from "./candidate-session-core.ts";
import type {
  NinebotCandidateSessionFields,
  NinebotTravelMonthResponseCandidate,
} from "./candidate-contracts.ts";

const session: NinebotCandidateSessionFields = {
  sys_language: "zh",
  client_ver: "synthetic",
  device_id: "synthetic",
  regionx: "bj",
  language: "zh",
  ostype: "and",
  lang: "zh",
  platform_ver: "13 synthetic",
  platform: "android",
  login_country: "CN",
  access_token: "synthetic",
  uid: "synthetic",
};
const input = {
  service: "ebike",
  serialNumber: "synthetic",
  vehicleType: "67",
  month: "202610",
} as const;
const page = (
  number: number,
  count: number,
  times: number | string | null = 40,
): NinebotTravelMonthResponseCandidate => ({
  code: 1,
  desc: "synthetic-private",
  detail: [],
  duration: 100,
  ec: 20,
  first_time: null,
  total_mileages: 10,
  times,
  month: input.month,
  list: Array.from({ length: count }, (_, index) => ({
    travel_id: `synthetic-${number}-${index}`,
  })),
});
const create = (month: CandidateTravelSessionClient["month"], paginateTravelMonths = true) =>
  createNinebotCandidateSessionClientFromClients({
    session,
    paginateTravelMonths,
    nonceFactory: () => "0123456789abcdef0123456789abcdef",
    clients: {
      vehicles: {
        list: async () => ({ code: 1, data: [], desc: null, time_cost: null, extra: null }),
      },
      telemetry: {
        status: async () => ({ code: 1, data: [], desc: null, time_cost: null, extra: null }),
        battery: async () => ({ code: 1, data: {}, desc: null, time_cost: null, extra: null }),
      },
      travel: { month, detail: async () => ({ code: 1, desc: null }) },
    },
  });

const rejectPages = async (
  first: NinebotTravelMonthResponseCandidate,
  next?: NinebotTravelMonthResponseCandidate,
) => {
  const request = vi.fn(async ({ fields }: Parameters<CandidateTravelSessionClient["month"]>[0]) =>
    fields.page === "1" ? first : (next ?? page(2, 0, first.times)),
  );
  const client = create(request);
  const result = await client.month(input).then(
    () => null,
    (error: unknown) => error,
  );
  expect(result).toBeInstanceOf(Error);
  expect(String(result)).toMatch(/Ninebot travel month/);
  expect(String(result)).not.toContain("synthetic-private");
  expect(request.mock.calls.length).toBeLessThanOrEqual(2);
};

describe("complete SDK monthly pagination (offline)", () => {
  it("preserves coherent totals and rows across 20/20/5 pages", async () => {
    const request = vi.fn(
      async ({ fields }: Parameters<CandidateTravelSessionClient["month"]>[0]) =>
        page(Number(fields.page), fields.page === "3" ? 5 : 20, "45"),
    );
    const result = await create(request).month(input);
    expect(result.list).toHaveLength(45);
    expect(new Set(result.list.map((row) => row.travel_id)).size).toBe(45);
    expect(result).toMatchObject({
      month: input.month,
      times: "45",
      duration: 100,
      total_mileages: 10,
    });
    expect(request.mock.calls.map(([options]) => options.fields.page)).toEqual(["1", "2", "3"]);
  });
  it.each([0, 19, 20])(
    "does not request extra pages when the declared total %s is satisfied",
    async (count) => {
      const request = vi.fn(async () => page(1, count, count));
      expect((await create(request).month(input)).list).toHaveLength(count);
      expect(request).toHaveBeenCalledOnce();
    },
  );
  it("accepts unwrapped success, numeric-string summaries, and optional missing statistics", async () => {
    const first = { ...page(1, 20), code: null, duration: "100", ec: null };
    const next = { ...page(2, 20), duration: 100, ec: null };
    expect(
      (await create(async ({ fields }) => (fields.page === "1" ? first : next)).month(input)).list,
    ).toHaveLength(40);
    const empty = { ...page(1, 0, 0), duration: null, total_mileages: null, ec: null };
    expect(await create(async () => empty).month(input)).toEqual(empty);
  });
  it("accepts the same string ID aliases and trimming as the desktop parser", async () => {
    const value = page(1, 3, 3);
    value.list = [{ travel_id: " a " }, { travelId: "b" }, { id: "c" }];
    expect((await create(async () => value).month(input)).list).toEqual(value.list);
  });
  it("rejects a repeated full page even if its row count appears complete", async () =>
    rejectPages(page(1, 20), page(1, 20)));
  it("rejects overlap between different pages", async () => {
    const next = page(2, 20);
    next.list = [{ travel_id: "synthetic-1-0" }, ...next.list.slice(1)];
    await rejectPages(page(1, 20), next);
  });
  it("rejects duplicate trimmed ids and aliases within one short page", async () => {
    const value = page(1, 2, 2);
    value.list = [{ travel_id: " duplicated " }, { id: "duplicated" }];
    await rejectPages(value);
  });
  it.each([{}, { travel_id: "" }, { travel_id: "   " }, { travel_id: 123 }])(
    "rejects a row whose id the desktop would drop %#",
    async (row) => {
      const value = page(1, 1, 1);
      value.list = [row];
      await rejectPages(value);
    },
  );
  it.each([null, "", " ", "invalid", -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an unprovable declared total %s",
    async (total) => rejectPages(page(1, 0, total)),
  );
  it.each([0, 7, 19])("rejects first-page truncation (%s rows of 40)", async (count) =>
    rejectPages(page(1, count)),
  );
  it.each([0, 5, 19])("rejects a premature final page (%s rows)", async (count) =>
    rejectPages(page(1, 20), page(2, count)),
  );
  it("rejects rows exceeding the declared total", async () => rejectPages(page(1, 2, 1)));
  it.each(["times", "duration", "total_mileages", "ec", "month"] as const)(
    "rejects %s disagreement between pages",
    async (key) => {
      const next = { ...page(2, 20), [key]: key === "month" ? "202609" : 99 };
      await rejectPages(page(1, 20), next);
    },
  );
  it("rejects a response for the wrong requested month before requesting another page", async () =>
    rejectPages({ ...page(1, 1, 1), month: "202609" }));
  it.each(["duration", "ec", "total_mileages"] as const)(
    "rejects invalid %s without returning partial data",
    async (key) => rejectPages({ ...page(1, 1, 1), [key]: "synthetic-private" }),
  );
  it.each([0, 2, "synthetic-private"])(
    "does not accept business rejection %s as an empty successful month",
    async (code) => rejectPages({ ...page(1, 0, 0), code }),
  );
  it("enforces the 100-page cap without requesting page101", async () => {
    const request = vi.fn(
      async ({ fields }: Parameters<CandidateTravelSessionClient["month"]>[0]) =>
        page(Number(fields.page), 20, 2001),
    );
    await expect(create(request).month(input)).rejects.toThrow(/page limit/i);
    expect(request).toHaveBeenCalledTimes(100);
  });
  it("rejects a response arriving after caller cancellation", async () => {
    let release!: (value: NinebotTravelMonthResponseCandidate) => void;
    let started!: () => void;
    const secondStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const request = vi.fn(
      async ({ fields }: Parameters<CandidateTravelSessionClient["month"]>[0]) => {
        if (fields.page === "1") return page(1, 20);
        started();
        return new Promise<NinebotTravelMonthResponseCandidate>((resolve) => {
          release = resolve;
        });
      },
    );
    const controller = new AbortController();
    const pending = create(request).month({ ...input, signal: controller.signal });
    await secondStarted;
    controller.abort(new Error("synthetic cancellation"));
    release(page(2, 20));
    await expect(pending).rejects.toThrow("synthetic cancellation");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("discards a first-page result arriving after session clear", async () => {
    let release!: (value: NinebotTravelMonthResponseCandidate) => void;
    const client = create(
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = client.month(input);
    client.clear();
    release(page(1, 0, 0));
    await expect(pending).rejects.toThrow(/cleared|closed|cancel/i);
  });
  it("never returns partial rows when a later request fails", async () => {
    const request = vi.fn(
      async ({ fields }: Parameters<CandidateTravelSessionClient["month"]>[0]) => {
        if (fields.page === "1") return page(1, 20);
        throw new Error("synthetic transport failure");
      },
    );
    await expect(create(request).month(input)).rejects.toThrow("synthetic transport failure");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("keeps explicit single-page mode without claiming completeness", async () => {
    const value = page(1, 20, null);
    const request = vi.fn(async () => value);
    expect(await create(request, false).month(input)).toBe(value);
    expect(request).toHaveBeenCalledOnce();
  });
});
