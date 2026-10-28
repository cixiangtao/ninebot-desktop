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
const output = resolve(process.env.NINEBOT_QA_OUTPUT_DIR ?? "/tmp/ninebot-ride-selection-qa");
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
const fixtures = {
  vehicles: demoVehicles.map((vehicle) => ({ ...vehicle, name: `${vehicle.name} · 演示车辆` })),
  rides: demoRides,
  snapshots: demoVehicleSnapshots,
  details: Object.fromEntries(demoRides.map((ride) => [ride.id, createDemoDetail(ride)])),
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
// Delay the synthetic bridge so layout changes during requests are observable.
await page.addInitScript(() => {
  const originalDetail = window.ninebot.rides.detail;
  const originalList = window.ninebot.rides.list;
  const control = {
    delayMs: 600,
    pending: 0,
    failNext: false,
    emptyNext: false,
    slowRideId: null,
    listCalls: 0,
  };
  window.rideSelectionQa = control;
  window.ninebot.rides.detail = async (input) => {
    const fail = control.failNext;
    control.failNext = false;
    const delay = control.slowRideId === input.rideId ? 1100 : control.delayMs;
    control.pending += 1;
    try {
      await new Promise((done) => setTimeout(done, delay));
      return fail
        ? { ok: false, error: { code: "UPSTREAM_ERROR", message: "Synthetic detail failure" } }
        : originalDetail(input);
    } finally {
      control.pending -= 1;
    }
  };
  window.ninebot.rides.list = async (input) => {
    control.listCalls += 1;
    const result = await originalList(input);
    if (!control.emptyNext || !result.ok) return result;
    control.emptyNext = false;
    return {
      ok: true,
      data: {
        ...result.data,
        rides: [],
        days: [],
        summary: {
          ...result.data.summary,
          rideCount: 0,
          visibleRideCount: 0,
          mileageKm: 0,
          durationSeconds: 0,
          energyWh: 0,
        },
      },
    };
  };
});
page.setDefaultTimeout(10000);
const ready = () =>
  page.waitForFunction(
    () =>
      window.rideSelectionQa.pending === 0 &&
      !document.querySelector(".workspace-status")?.textContent.includes("正在同步"),
  );
const measure = () =>
  page.evaluate(() => ({
    summaryHeight: document.querySelector(".ride-month-summary").getBoundingClientRect().height,
    verificationHeight: document.querySelector(".ride-speed-verification").getBoundingClientRect()
      .height,
    listTop: document.querySelector(".ride-history-groups").getBoundingClientRect().top,
    scrollTop: document.querySelector(".ride-list").scrollTop,
  }));
const assertStable = (actual, expected) => {
  for (const key of ["summaryHeight", "verificationHeight", "listTop", "scrollTop"])
    assert.equal(actual[key], expected[key], `${key} changed`);
};
try {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort(),
  );
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator(".playback-panel").waitFor();
  await ready();
  for (const [width, height] of [
    [1440, 900],
    [1080, 680],
  ]) {
    await page.setViewportSize({ width, height });
    await page.locator(".ride-list").evaluate((el) => {
      el.scrollTop = 0;
    });
    const before = await measure();
    await page.locator(".ride-row").nth(1).click();
    await page.waitForFunction(() => window.rideSelectionQa.pending > 0);
    assertStable(await measure(), before);
    assert.equal(await page.locator(".month-button").isEnabled(), true);
    assert.equal(await page.locator(".metrics-panel").count(), 0);
    await ready();
    assertStable(await measure(), before);
    console.log(
      `${width}x${height}: stable before/during/after delayed detail`,
      JSON.stringify(before),
    );
    // Preserve the current scroll position while changing an already-visible ride.
    await page.locator(".ride-row").last().scrollIntoViewIfNeeded();
    const scrolled = await measure();
    await page.locator(".ride-row").last().click();
    await page.waitForFunction(() => window.rideSelectionQa.pending > 0);
    assertStable(await measure(), scrolled);
    await ready();
    assertStable(await measure(), scrolled);
  }
  await page.locator(".ride-row").first().scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    window.rideSelectionQa.failNext = true;
  });
  const failureBefore = await measure();
  await page.locator(".ride-row").first().click();
  await ready();
  assertStable(await measure(), failureBefore);
  assert.equal(await page.locator(".metrics-panel").count(), 0);
  assert.equal(await page.getByText("轨迹读取失败", { exact: true }).isVisible(), true);
  // A slower, older response must not overwrite a newer selection.
  await page.evaluate((id) => {
    window.rideSelectionQa.slowRideId = id;
  }, fixtures.rides[0].id);
  await page.locator(".ride-row").first().click();
  await page.locator(".ride-row").nth(1).click();
  await ready();
  assert.equal(await page.locator(".ride-row").nth(1).getAttribute("aria-pressed"), "true");
  assert.equal(
    await page.locator(".metrics-panel .metric-number").first().textContent(),
    fixtures.details[fixtures.rides[1].id].sampledMaxSpeed.toFixed(0),
  );
  // Refreshing the month can cancel a pending detail without leaving loading stuck.
  await page.locator(".ride-row").first().click();
  await page.waitForFunction(() => window.rideSelectionQa.pending > 0);
  await page.evaluate(() => {
    window.rideSelectionQa.emptyNext = true;
  });
  await page.getByRole("button", { name: "刷新行程", exact: true }).click();
  await ready();
  assert.equal(await page.locator(".ride-row").count(), 0);
  assert.equal(await page.locator(".playback-panel").count(), 0);
  assert.equal(await page.locator(".month-button").isEnabled(), true);
  assert.equal(
    await page
      .locator(".empty-month-panel")
      .textContent()
      .then((text) => text.includes("没有行程")),
    true,
  );
  await page.getByRole("button", { name: "刷新行程", exact: true }).click();
  await page.locator(".playback-panel").waitFor();
  await ready();
  assert.equal(await page.locator(".ride-row").count(), fixtures.rides.length);
  assert.deepEqual(errors, []);
  console.log(
    "Ride-selection regression passed: two sizes, scrolled list, failures, out-of-order details, month cancellation and recovery. Synthetic data only.",
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
