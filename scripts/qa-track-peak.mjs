// UI steps share one page and must run in order.
/* oxlint-disable no-await-in-loop */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";
import {
  demoVehicles,
  demoRides,
  demoVehicleSnapshots,
  createDemoDetail,
} from "../src/renderer/src/data/demo.ts";

// Synthetic renderer-only review: no account, keychain, or Ninebot cloud access.
const root = resolve(import.meta.dirname, "..");
const output = resolve(process.env.NINEBOT_QA_OUTPUT_DIR ?? "/tmp/ninebot-track-peak-qa");
await mkdir(output, { recursive: true });
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const path = resolve(root, "out/renderer", `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!path.startsWith(resolve(root, "out/renderer") + "/")) throw new Error("Invalid path");
    res.setHeader("Content-Type", mime[extname(path)] ?? "application/octet-stream");
    res.end(await readFile(path));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const testRides = Array.from({ length: 24 }, (_, index) => ({
  ...demoRides[index % demoRides.length],
  id: `peak-${index}`,
  startTime: demoRides[0].startTime - index * 3600,
  endTime: demoRides[0].startTime - index * 3600 + 600,
}));
const fixtures = {
  vehicles: demoVehicles.map((vehicle) => ({ ...vehicle, name: `${vehicle.name} · 演示车辆` })),
  rides: testRides,
  snapshots: demoVehicleSnapshots,
  details: Object.fromEntries(testRides.map((ride) => [ride.id, createDemoDetail(ride)])),
};
await page.addInitScript((data) => {
  // Serialized into the browser; helpers must stay inside this callback.
  // oxlint-disable-next-line consistent-function-scoping
  const ok = (value) => Promise.resolve({ ok: true, data: value });
  window.ninebot = {
    auth: { status: () => ok({ connected: true }), onSessionExpired: () => () => {} },
    vehicles: {
      list: () => ok(data.vehicles),
      snapshot: ({ vehicleId }) => ok(data.snapshots[vehicleId]),
    },
    rides: {
      list: ({ month }) => {
        const days = Array.from(
          { length: new Date(Number(month.slice(0, 4)), Number(month.slice(4)), 0).getDate() },
          (_, i) => ({ day: i + 1, mileageKm: i % 3 === 0 ? 12.6 : 0 }),
        );
        return ok({
          rides: data.rides,
          days,
          summary: {
            month,
            historyStartTime: 1735689600,
            rideCount: data.rides.length,
            mileageKm: 59.9,
            durationSeconds: 7798,
            energyWh: 1675,
            visibleRideCount: data.rides.length,
            aggregateAvailable: true,
            ridesTruncated: false,
            activeDayCount: days.filter((d) => d.mileageKm > 0).length,
            longestDayMileageKm: 12.6,
          },
        });
      },
      detail: ({ rideId }) => ok(data.details[rideId]),
      verifySpeeds: () =>
        ok({
          rides: Object.values(data.details).map(({ id, declaredMaxSpeed, sampledMaxSpeed }) => ({
            id,
            declaredMaxSpeed,
            sampledMaxSpeed,
          })),
          failedRideCount: 0,
        }),
    },
  };
}, fixtures);
await page.addInitScript(
  (ids) => {
    const originalList = window.ninebot.rides.list;
    const originalDetail = window.ninebot.rides.detail;
    const control = {
      month: null,
      batches: [],
      reads: [],
      failedOnce: false,
      active: 0,
      maxActive: 0,
      hold: true,
    };
    window.trackPeakQa = control;
    window.ninebot.rides.list = async (input) => {
      const result = await originalList(input);
      if (!result.ok) return result;
      control.month ??= input.month;
      const rides =
        input.month === control.month
          ? result.data.rides.map((ride, index) => ({
              ...ride,
              declaredMaxSpeed: [41, 64, 25, 0][index] ?? 41,
            }))
          : [];
      return {
        ok: true,
        data: {
          ...result.data,
          rides,
          summary: {
            ...result.data.summary,
            month: input.month,
            rideCount: rides.length,
            visibleRideCount: rides.length,
          },
        },
      };
    };
    window.ninebot.rides.detail = async (input) => {
      control.reads.push(input.rideId);
      const result = await originalDetail(input);
      if (!result.ok) return result;
      const index = ids.indexOf(input.rideId);
      const peak = index < 4 ? [37, null, 25, 0][index] : 37;
      await new Promise((done) => setTimeout(done, 200));
      return {
        ok: true,
        data: {
          ...result.data,
          declaredMaxSpeed: [41, 64, 25, 0][index] ?? 41,
          sampledMaxSpeed: peak,
          track:
            peak === null
              ? []
              : result.data.track.map((point) => ({
                  ...point,
                  speed: Math.min(peak, point.speed),
                })),
        },
      };
    };
    window.ninebot.rides.verifySpeeds = async ({ rideIds }) => {
      control.batches.push([...rideIds]);
      control.active += 1;
      control.maxActive = Math.max(control.maxActive, control.active);
      while (control.hold) await new Promise((done) => setTimeout(done, 20));
      await new Promise((done) => setTimeout(done, 150));
      control.active -= 1;
      const failed = !control.failedOnce && rideIds.includes(ids[2]) ? ids[2] : null;
      if (failed) control.failedOnce = true;
      return {
        ok: true,
        data: {
          rides: rideIds
            .filter((id) => id !== failed)
            .map((id) => {
              const index = ids.indexOf(id);
              return {
                id,
                declaredMaxSpeed: [41, 64, 25, 0][index] ?? 41,
                sampledMaxSpeed: index < 4 ? [37, null, 25, 0][index] : 37,
              };
            }),
          failedRideCount: failed === null ? 0 : 1,
        },
      };
    };
  },
  fixtures.rides.map(({ id }) => id),
);
const value = (index) =>
  page.locator(".ride-row").nth(index).locator(".ride-speed-reading strong").textContent();
try {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator(".metrics-panel").waitFor();
  assert.equal(await value(0), "37");
  assert.equal(await value(1), "—");
  assert.equal(await value(2), "—");
  assert.equal(await page.locator(".metrics-panel .metric-number").textContent(), "37");
  for (const [width, height] of [
    [1440, 900],
    [1080, 680],
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(
      await page
        .locator(".ride-row")
        .evaluateAll((els) =>
          els.some((el) => el.scrollWidth > el.clientWidth + 1 || el.clientHeight !== 70),
        ),
      false,
    );
    await page.screenshot({
      path: resolve(output, `track-peaks-${width}.png`),
      animations: "disabled",
    });
  }
  const topBefore = await page
    .locator(".ride-history-groups")
    .evaluate((el) => el.getBoundingClientRect().top);
  await page.evaluate(() => {
    window.trackPeakQa.hold = false;
  });
  await page.waitForFunction(
    () => document.querySelectorAll('.ride-speed-reading[data-source="unavailable"]').length > 0,
  );
  await page.getByRole("button", { name: "补全未读", exact: true }).waitFor();
  assert.equal(
    await page.locator(".ride-history-groups").evaluate((el) => el.getBoundingClientRect().top),
    topBefore,
  );
  const initial = await page.evaluate(() => window.trackPeakQa);
  assert.equal(initial.reads.length, 1, "automatic peaks must not open details");
  assert.ok(
    initial.batches.length > 1 && initial.batches.length < 24,
    "only nearby cards should load",
  );
  assert.equal(await value(1), "—");
  assert.equal(await value(2), "—", "failed reads must not use interface speed");
  await page.locator(".ride-row").last().scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () =>
      document.querySelector('.ride-row:last-child [data-source="track"]') !== null &&
      document.querySelector('[data-ride-id="peak-23"] .ride-speed-reading strong').textContent ===
        "37",
  );
  assert.equal(await page.locator(".metrics-panel .metric-number").textContent(), "37");
  assert.equal((await page.evaluate(() => window.trackPeakQa.reads)).length, 1);
  await page.locator(".ride-row").nth(1).click();
  await page.locator(".metrics-panel").waitFor();
  assert.equal(await page.locator(".metrics-panel .metric-number").textContent(), "—");
  await page.locator(".ride-list").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.getByRole("button", { name: "补全未读", exact: true }).waitFor();
  const beforeManual = await page.evaluate(() => window.trackPeakQa.batches.flat());
  await page.getByRole("button", { name: "补全未读", exact: true }).click();
  await page.getByRole("button", { name: "已补全", exact: true }).waitFor();
  const afterManual = await page.evaluate(() => window.trackPeakQa);
  assert.equal(afterManual.maxActive, 2);
  assert.ok(afterManual.batches.every((ids) => ids.length === 1));
  for (const id of beforeManual.filter((candidate) => candidate !== "peak-2")) {
    assert.equal(afterManual.batches.flat().filter((candidate) => candidate === id).length, 1);
  }
  assert.equal(afterManual.batches.flat().filter((id) => id === "peak-2").length, 2);
  assert.deepEqual(await Promise.all([0, 1, 2, 3].map(value)), ["37", "—", "25", "0"]);
  await page.screenshot({
    path: resolve(output, "track-peaks-automatic.png"),
    animations: "disabled",
  });
  await page.locator(".month-button").click();
  const currentMonth = await page.locator(".month-cell-selected").textContent();
  const previousMonth = `${Number(currentMonth.replace("月", "")) - 1}月`;
  await page
    .locator(".month-grid")
    .getByRole("button", { name: previousMonth, exact: true })
    .click();
  await page.locator(".ride-list-empty").waitFor();
  await page.locator(".month-button").click();
  await page
    .locator(".month-grid")
    .getByRole("button", { name: currentMonth, exact: true })
    .click();
  await page.locator(".metrics-panel").waitFor();
  assert.deepEqual(await Promise.all([0, 1, 2, 3].map(value)), ["37", "—", "25", "0"]);
  assert.equal(await page.getByRole("button", { name: "已补全", exact: true }).isDisabled(), true);
  assert.equal(
    (await page.evaluate(() => window.trackPeakQa.batches)).length,
    afterManual.batches.length,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Automatic track peaks passed: viewport-only loading without clicks, progressive scroll loading, concurrency two, stable geometry, explicit failure retry, no duplicate completed reads, month reuse, list/detail agreement and empty/zero handling. Synthetic data only.",
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
