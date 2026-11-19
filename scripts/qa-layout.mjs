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
const output = resolve(root, ".impeccable/review/layout");
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
            maxDailyMileageKm: 12.6,
          },
        });
      },
      detail: ({ rideId }) => ok(data.details[rideId]),
      verifySpeeds: () =>
        ok(
          Object.values(data.details).map(({ id, declaredMaxSpeed, sampledMaxSpeed }) => ({
            id,
            declaredMaxSpeed,
            sampledMaxSpeed,
          })),
        ),
    },
  };
}, fixtures);
const nav = (label) =>
  page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: label, exact: true });

const luminance = (color) =>
  color
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number)
    .map((value) => value / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);

const checkThemeContrast = async () => {
  const contrastPairs = await page.evaluate(() => {
    const pairs = [
      [".metrics-panel .metric-label", ".metrics-panel"],
      [".metrics-panel .metric-reading", ".metrics-panel"],
      [".metrics-panel .metric-number", ".metrics-panel"],
      [".nav-item-active", ".nav-item-active"],
    ];
    return pairs.map(([fg, bg]) => [
      getComputedStyle(document.querySelector(fg)).color,
      getComputedStyle(document.querySelector(bg)).backgroundColor,
    ]);
  });
  for (const [foreground, background] of contrastPairs) {
    const values = [luminance(foreground), luminance(background)].toSorted((a, b) => b - a);
    assert(
      (values[0] + 0.05) / (values[1] + 0.05) >= 4.5,
      `Insufficient contrast: ${foreground} / ${background}`,
    );
  }
};

const capture = async (name) => {
  await page.mouse.move(90, 5);
  await page.screenshot({ path: resolve(output, `${name}.png`), animations: "disabled" });
  const geometry = await page.evaluate(() => {
    const selectors = [
      ".navigation-rail",
      ".titlebar",
      ".sidebar",
      ".metrics-panel",
      ".playback-panel",
      ".route-map",
    ];
    return Object.fromEntries(
      selectors.map((selector) => {
        const el = document.querySelector(selector);
        const r = el?.getBoundingClientRect();
        return [
          selector,
          r
            ? {
                x: r.x,
                y: r.y,
                right: r.right,
                bottom: r.bottom,
                width: r.width,
                height: r.height,
                scrollHeight: el.scrollHeight,
              }
            : null,
        ];
      }),
    );
  });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    `${name}: horizontal overflow`,
  );
  console.log(name, JSON.stringify(geometry));
};
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator(".playback-panel").waitFor();
  await page.waitForTimeout(3500);
  for (const [width, height, size] of [
    [1440, 900, "desktop"],
    [1080, 680, "compact"],
  ]) {
    await page.setViewportSize({ width, height });
    await nav("轨迹").click();
    await page.waitForTimeout(900);
    await page.getByRole("button", { name: "显示完整轨迹", exact: true }).click();
    await page.waitForTimeout(700);
    await capture(`rides-${size}`);
    await checkThemeContrast();
    const panelFits = await page
      .locator(".playback-panel")
      .evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
    assert(panelFits, "playback controls overflow the dock");
    const actionBounds = await page.locator(".ride-metric-actions").boundingBox();
    const metricBounds = await page.locator(".metrics-panel").boundingBox();
    assert(
      actionBounds.x + actionBounds.width <= metricBounds.x + metricBounds.width,
      "metric actions overflow",
    );
    const play = page.getByRole("button", { name: "开始回放", exact: true });
    await play.click();
    await page.getByRole("button", { name: "暂停回放", exact: true }).click();
    await page.getByRole("slider", { name: "回放进度", exact: true }).press("ArrowRight");
    await page.getByRole("button", { name: "展开骑行日历" }).click();
    await page.getByRole("button", { name: "收起骑行日历" }).click();
    await page.locator(".month-button").click();
    const picker = await page.locator(".month-picker").boundingBox();
    assert(picker.y >= 0 && picker.y + picker.height <= height, "month picker out of view");
    await page.locator(".month-button").click();
    await page.locator(".ride-row").last().click();
    await nav("设备").click();
    await page.locator(".battery-orbit").waitFor();
    await capture(`device-${size}`);
    assert.equal(await page.locator(".sidebar").count(), 0);
    await nav("统计").click();
    await page.locator(".statistics-summary-card").first().waitFor();
    await capture(`statistics-${size}`);
    await nav("地图").click();
    await capture(`location-consent-${size}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await nav("轨迹").click();
  await page.locator(".playback-panel").waitFor();
  const beforeTheme = await page.locator(".metric-number").textContent();
  const progressBeforeTheme = await page
    .getByRole("slider", { name: "回放进度", exact: true })
    .inputValue();
  const legendBeforeTheme = await page.locator(".map-speed-legend").innerHTML();
  for (const [id, name] of [
    ["mint", "清爽青绿"],
    ["blue", "晴空蓝"],
    ["violet", "柔雾紫"],
    ["apricot", "暖杏橙"],
    ["forest", "松绿撞色"],
  ]) {
    await page.getByRole("button", { name: "切换配色", exact: true }).click();
    await page.getByText(name, { exact: true }).click();
    assert.equal(await page.locator("html").getAttribute("data-theme"), id);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("ninebot-desktop.theme") ?? "mint"),
      id,
    );
    const panel = await page.getByRole("dialog", { name: "界面配色" }).boundingBox();
    assert(panel.x >= 0 && panel.y + panel.height <= 900);
    if (id === "mint") await capture("theme-picker-desktop");
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .getByRole("button", { name: "切换配色", exact: true })
        .evaluate((el) => document.activeElement === el),
      true,
    );
    await capture(`theme-${id}`);
    await checkThemeContrast();
    assert.equal(await page.locator(".metric-number").textContent(), beforeTheme);
    assert.equal(
      await page.getByRole("slider", { name: "回放进度", exact: true }).inputValue(),
      progressBeforeTheme,
    );
    assert.equal(await page.locator(".map-speed-legend").innerHTML(), legendBeforeTheme);
  }
  await nav("设备").click();
  await capture("theme-forest-device");
  await page.reload();
  await page.locator(".playback-panel").waitFor();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "forest");
  await page.setViewportSize({ width: 1080, height: 680 });
  await page.getByRole("button", { name: "切换配色", exact: true }).click();
  await page.getByText("清爽青绿", { exact: true }).click();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("html").getAttribute("data-theme"), "blue");
  await page.getByText("清爽青绿", { exact: true }).click();
  const themePanel = await page.getByRole("dialog", { name: "界面配色" }).boundingBox();
  assert(
    themePanel.x >= 0 && themePanel.y + themePanel.height <= 680,
    "theme picker outside compact window",
  );
  await capture("theme-picker-compact");
  await page.locator(".workspace-title").click();
  assert.equal(await page.getByRole("dialog", { name: "界面配色" }).count(), 0);
  await page.reload();
  await page.locator(".playback-panel").waitFor();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "mint");
  await page.getByRole("button", { name: "重新连接账号", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await capture("login-compact");
  assert.deepEqual(errors, []);
  console.log(
    "Layout smoke passed: two desktop sizes, four views, calendar, month picker, ride selection, playback, login, five palettes, persistence and keyboard selection.",
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
