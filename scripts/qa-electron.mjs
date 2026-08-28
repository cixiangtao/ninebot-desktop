import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { _electron as electron } from "playwright";

const projectRoot = resolve(import.meta.dirname, "..");
const reviewDirectory = resolve(projectRoot, ".impeccable/review");
const qaUserDataDirectory = await mkdtemp(resolve(tmpdir(), "ninebot-desktop-qa-"));
const qaExportPath = resolve(qaUserDataDirectory, "ride-export.json");
const qaMonthExportPath = resolve(qaUserDataDirectory, "month-summary-export.json");
const qaYearExportPath = resolve(qaUserDataDirectory, "year-summary-export.json");
const qaNow = new Date();
const qaCurrentYear = qaNow.getFullYear();
const qaCurrentMonth = qaNow.getMonth() + 1;
const qaPreviousMonth = qaCurrentMonth === 1 ? 12 : qaCurrentMonth - 1;
const qaPreviousYear = qaCurrentMonth === 1 ? qaCurrentYear - 1 : qaCurrentYear;
const qaCurrentMonthLabel = `${qaCurrentYear}年${qaCurrentMonth}月`;

const app = await electron.launch({
  args: [".", `--user-data-dir=${qaUserDataDirectory}`],
  cwd: projectRoot,
});
const window = await app.firstWindow();
let auditLocationRequests = false;
let locationMapRequestCount = 0;
window.on("console", (message) => {
  if (message.type() === "error") {
    console.log("renderer-console", message.type(), message.text());
  }
});
window.on("request", (request) => {
  if (auditLocationRequests && request.url().startsWith("https://tiles.openfreemap.org/")) {
    locationMapRequestCount += 1;
  }
});
window.on("pageerror", (error) => console.log("renderer-pageerror", error.message));
window.on("requestfailed", (request) => {
  const url = new URL(request.url());
  console.log("request-failed", url.origin, request.failure()?.errorText);
});

const setContentSize = async (width, height) => {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
    },
    { width, height },
  );
  await window.waitForTimeout(180);
};

const captureCssPixels = async (filename) => {
  const bytes = await app.evaluate(async ({ BrowserWindow }) => {
    const currentWindow = BrowserWindow.getAllWindows()[0];
    if (!currentWindow) throw new Error("Missing BrowserWindow");
    const image = await currentWindow.capturePage();
    const [width, height] = currentWindow.getContentSize();
    return image.resize({ width, height, quality: "best" }).toPNG();
  });
  await writeFile(resolve(reviewDirectory, filename), Buffer.from(bytes));
};

const shellMetrics = async () =>
  window.evaluate(() => {
    const selectors = [".sidebar", ".metrics-panel", ".playback-panel", ".route-map"];
    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
      regions: Object.fromEntries(
        selectors.map((selector) => {
          const rect = document.querySelector(selector)?.getBoundingClientRect();
          return [
            selector,
            rect
              ? {
                  x: rect.x,
                  y: rect.y,
                  width: rect.width,
                  height: rect.height,
                  right: rect.right,
                  bottom: rect.bottom,
                }
              : null,
          ];
        }),
      ),
    };
  });

try {
  await window.waitForSelector(".playback-panel");
  await window.waitForFunction(
    () =>
      document.querySelector(".online-map-ready") !== null ||
      document.querySelector(".map-fallback-note") !== null,
    null,
    { timeout: 12_000 },
  );
  await window.waitForTimeout(1_200);
  await window.waitForTimeout(2_000);
  console.log("title", await window.title());
  console.log("rides", await window.locator(".ride-row").count());
  await window.getByRole("button", { name: "展开骑行日历" }).click();
  const activityCalendarDayCount = await window.locator(".ride-activity-days button").count();
  const activityCalendarActiveDayCount = await window.locator(".ride-activity-day-active").count();
  console.log("activity-calendar-days", activityCalendarDayCount);
  console.log("activity-calendar-active-days", activityCalendarActiveDayCount);
  if (activityCalendarDayCount < 28 || activityCalendarActiveDayCount < 1) {
    throw new Error("Monthly activity calendar is not populated");
  }
  await window.locator(".ride-activity-day-active").first().click();
  const filteredRideCount = await window.locator(".ride-row").count();
  console.log("activity-calendar-filtered-rides", filteredRideCount);
  if (filteredRideCount < 1 || filteredRideCount >= 7) {
    throw new Error("Monthly activity calendar did not filter the selectable rides");
  }
  await window.getByRole("button", { name: "显示全部" }).click();
  if ((await window.locator(".ride-row").count()) !== 7) {
    throw new Error("Monthly activity calendar did not restore all selectable rides");
  }
  await captureCssPixels("activity-calendar.png");
  await window.getByRole("button", { name: "收起骑行日历" }).click();
  const speedVerificationPrivacyVisible = await window.getByText(/页面只接收速度摘要/).isVisible();
  await window.getByRole("button", { name: "校验全部", exact: true }).click();
  await window.getByText(/已校验 7\/7 条/).waitFor();
  const verifiedRideSpeedCount = await window
    .locator('.ride-speed-reading[data-source="track"]')
    .count();
  console.log("ride-speed-verification", speedVerificationPrivacyVisible, verifiedRideSpeedCount);
  if (!speedVerificationPrivacyVisible || verifiedRideSpeedCount !== 7) {
    throw new Error("Monthly ride speed verification did not update every visible row");
  }
  await captureCssPixels("ride-speed-verification.png");
  await app.evaluate(({ dialog }, exportPath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath });
  }, qaMonthExportPath);
  await window.getByRole("button", { name: "导出本月清单" }).click();
  const monthExportDialog = window.getByRole("dialog", { name: "选择月度导出格式" });
  console.log("month-export-dialog", await monthExportDialog.isVisible());
  console.log(
    "month-export-speed-evidence",
    await monthExportDialog.getByText(/已用轨迹校验 7\/7 条/).isVisible(),
  );
  console.log(
    "month-export-privacy-warning",
    await monthExportDialog.getByText(/不包含 GPS、轨迹点、车辆 SN/).isVisible(),
  );
  await captureCssPixels("month-summary-export.png");
  await monthExportDialog.getByRole("button", { name: /JSON 数据/ }).click();
  await monthExportDialog.waitFor({ state: "hidden" });
  const exportedMonthSummary = JSON.parse(await readFile(qaMonthExportPath, "utf8"));
  const exportedMonthText = JSON.stringify(exportedMonthSummary);
  const monthExportValid =
    exportedMonthSummary.schemaVersion === 1 &&
    exportedMonthSummary.rides.length === 7 &&
    exportedMonthSummary.coverage.verifiedSpeedCount === 7 &&
    exportedMonthSummary.rides.every(
      (ride) => ride.maximumSpeedSource === "track" && !Object.hasOwn(ride, "id"),
    ) &&
    !/longitude|latitude|trail|vehicleId|travel_id|travelId/.test(exportedMonthText);
  console.log("month-export-saved", monthExportValid);
  if (!monthExportValid) {
    throw new Error("Month summary export is incomplete, unverified, or exposes identifiers");
  }
  console.log(
    "map-mode",
    (await window.locator(".online-map-ready").count()) > 0 ? "online" : "fallback",
  );
  console.log("speed-legend", await window.locator(".map-speed-legend").isVisible());
  const routeSpeedColors = await window
    .locator(".route-fallback-canvas line[stroke]")
    .evaluateAll((segments) => [
      ...new Set(segments.map((segment) => segment.getAttribute("stroke"))),
    ]);
  console.log("route-speed-color-count", routeSpeedColors.length);
  if (routeSpeedColors.length < 4)
    throw new Error("Route is not segmented into enough speed colors");
  console.log("desktop-metrics", JSON.stringify(await shellMetrics()));
  await captureCssPixels("desktop.png");

  await window.locator(".vehicle-card").click();
  console.log("vehicle-picker-visible", await window.locator(".vehicle-picker").isVisible());
  console.log("vehicle-option-count", await window.getByRole("option").count());
  await window.getByRole("option", { name: /E125/ }).click();
  console.log("selected-demo-vehicle", await window.locator(".vehicle-card").textContent());
  console.log(
    "selected-demo-shared",
    (await window.locator(".vehicle-card").textContent())?.includes("共享车辆") === true,
  );
  await window.getByRole("button", { name: "设备", exact: true }).click();
  await window.getByRole("heading", { name: "E125", exact: true }).waitFor();
  console.log("switched-device-battery", await window.getByText("46", { exact: true }).isVisible());
  console.log("dual-battery-pack-count", await window.locator(".battery-pack-card").count());
  console.log(
    "dual-battery-lowest-score",
    await window.getByText("最低评分", { exact: true }).isVisible(),
  );
  console.log(
    "range-estimate-source-count",
    await window.locator(".vehicle-range-comparison p").count(),
  );
  console.log(
    "charging-time-visible",
    await window.getByText(/预计充满还需 1小时25分钟/).isVisible(),
  );
  console.log(
    "charge-completion-visible",
    await window.getByText(/预计充满还需 1小时25分钟 · \d{2}:\d{2} 完成/).isVisible(),
  );
  console.log("smart-service-visible", await window.getByText(/智能服务剩余 42 天/).isVisible());
  const sharedAuthorizationVisible = await window.getByText(/获得共享权限/).isVisible();
  console.log("shared-authorization-visible", sharedAuthorizationVisible);
  console.log(
    "lithium-battery-visible",
    await window.getByText("2 组锂电池数据", { exact: true }).isVisible(),
  );
  console.log("battery-cycle-tip-count", await window.locator(".battery-cycle-tips p").count());
  await captureCssPixels("device-dashboard-second-vehicle.png");
  await window.locator(".vehicle-card").click();
  await window.getByRole("option", { name: /F90/ }).click();
  await window.getByRole("heading", { name: "F90", exact: true }).waitFor();

  await window.waitForSelector(".vehicle-dashboard");
  console.log(
    "device-dashboard",
    await window.getByRole("heading", { name: "F90", exact: true }).isVisible(),
  );
  console.log("device-battery-demo", await window.getByText("78", { exact: true }).isVisible());
  const vehicleActivationVisible = await window
    .locator(".vehicle-dashboard-header")
    .getByText(/激活/)
    .isVisible();
  console.log("vehicle-activation-visible", vehicleActivationVisible);
  const demoBatterySourceVisible = await window
    .getByText("剩余电量 · 电池诊断", { exact: true })
    .isVisible();
  console.log("device-battery-source", demoBatterySourceVisible);
  if (!demoBatterySourceVisible || !sharedAuthorizationVisible || !vehicleActivationVisible) {
    throw new Error("Device dashboard does not disclose battery or lifecycle provenance");
  }
  console.log("single-battery-pack-count", await window.locator(".battery-pack-card").count());
  console.log(
    "single-vehicle-range-estimates",
    await window.locator(".vehicle-range-comparison p").count(),
  );
  console.log(
    "power-and-acc-separated",
    (await window.getByText("主电源", { exact: true }).isVisible()) &&
      (await window.getByText("ACC 状态", { exact: true }).isVisible()),
  );
  console.log(
    "device-readonly-boundary",
    await window.getByText(/车辆 SN、实时坐标和控制能力不会传给页面/).isVisible(),
  );
  await captureCssPixels("device-dashboard.png");
  auditLocationRequests = true;
  locationMapRequestCount = 0;
  await window.getByRole("button", { name: "地图", exact: true }).click();
  await window.waitForSelector(".location-consent-page");
  await window.waitForTimeout(300);
  console.log(
    "location-map-before-consent",
    await window.locator(".vehicle-location-online").count(),
  );
  console.log("location-requests-before-consent", locationMapRequestCount);
  await captureCssPixels("location-consent.png");
  await window.getByRole("button", { name: "查看演示位置" }).click();
  await window.waitForFunction(
    () =>
      document.querySelector(".vehicle-location-online-ready") !== null ||
      document.querySelector(".location-map-fallback-note") !== null,
    null,
    { timeout: 12_000 },
  );
  console.log(
    "location-map-after-consent",
    await window.locator(".vehicle-location-online").count(),
  );
  console.log(
    "location-acc-label",
    await window.getByText("ACC 状态", { exact: true }).isVisible(),
  );
  console.log("location-requests-after-consent", locationMapRequestCount);
  if ((await window.locator(".vehicle-location-online-ready").count()) > 0) {
    const locationCoordinateSource = window.getByRole("button", {
      name: "启用GCJ-02转WGS84坐标校准预览",
    });
    await locationCoordinateSource.waitFor();
    const locationCoordinateShift = Number(
      await locationCoordinateSource.getAttribute("data-shift-meters"),
    );
    await locationCoordinateSource.click();
    const locationCoordinatePreview = window.getByRole("button", {
      name: "关闭坐标校准预览并恢复接口原值",
    });
    await locationCoordinatePreview.waitFor({ timeout: 12_000 });
    const locationCoordinatePreviewActive =
      (await locationCoordinatePreview.getAttribute("data-coordinate-mode")) ===
      "gcj02-to-wgs84-preview";
    console.log(
      "location-coordinate-preview",
      locationCoordinatePreviewActive,
      locationCoordinateShift,
    );
    if (
      !locationCoordinatePreviewActive ||
      locationCoordinateShift < 100 ||
      locationCoordinateShift > 1_000
    ) {
      throw new Error("Vehicle location coordinate preview did not activate safely");
    }
    await window.waitForTimeout(1_200);
    await captureCssPixels("location-coordinate-preview.png");
    await locationCoordinatePreview.click();
    await locationCoordinateSource.waitFor({ timeout: 12_000 });
  }
  await captureCssPixels("location-dashboard.png");
  await window.getByRole("button", { name: "停止显示车辆位置" }).click();
  console.log("location-cleared", await window.locator(".location-consent-page").isVisible());
  await window.locator(".vehicle-card").click();
  await window.getByRole("option", { name: /E125/ }).click();
  auditLocationRequests = true;
  locationMapRequestCount = 0;
  await window.getByRole("button", { name: "查看演示位置" }).click();
  await window.getByText("共享权限不包含车辆位置", { exact: true }).waitFor();
  const deniedLocationMapCount = await window.locator(".vehicle-location-online").count();
  const deniedLocationRecoveryVisible = await window
    .getByRole("button", { name: "重新检查权限", exact: true })
    .isVisible();
  console.log("location-permission-denied", true);
  console.log("location-permission-map-count", deniedLocationMapCount);
  console.log("location-permission-tile-requests", locationMapRequestCount);
  console.log("location-permission-recovery", deniedLocationRecoveryVisible);
  if (
    deniedLocationMapCount !== 0 ||
    locationMapRequestCount !== 0 ||
    !deniedLocationRecoveryVisible
  ) {
    throw new Error("Denied shared-location permission still disclosed a map or lacked recovery");
  }
  await captureCssPixels("location-permission-denied.png");
  await window.getByRole("button", { name: "停止显示车辆位置" }).click();
  auditLocationRequests = false;
  await window.locator(".vehicle-card").click();
  await window.getByRole("option", { name: /F90/ }).click();
  await window.getByRole("button", { name: "统计", exact: true }).click();
  await window.waitForSelector(".statistics-dashboard");
  console.log("statistics-month-count", await window.locator(".statistics-month-row").count());
  console.log(
    "statistics-coverage-note",
    await window.getByText(/可选择的行程明细仍最多返回 20 条/).isVisible(),
  );
  console.log(
    "statistics-summary-card-count",
    await window.locator(".statistics-summary-card").count(),
  );
  console.log(
    "statistics-active-days",
    await window.getByText("活跃天数", { exact: true }).isVisible(),
  );
  console.log(
    "statistics-energy-summary",
    (await window
      .locator(".statistics-summary-card")
      .getByText("骑行能耗", { exact: true })
      .isVisible()) &&
      (await window
        .locator(".statistics-summary-card")
        .getByText("平均能耗", { exact: true })
        .isVisible()),
  );
  console.log(
    "statistics-activity-heatmap",
    await window.locator(".year-activity-card").isVisible(),
  );
  console.log(
    "statistics-active-day-cells",
    await window.locator(".year-activity-grid .year-activity-day-active").count(),
  );
  console.log(
    "statistics-activity-insights",
    (await window.getByText("最长连续骑行", { exact: true }).isVisible()) &&
      (await window.getByText("最常骑行", { exact: true }).isVisible()),
  );
  const statisticsTrendMetricCount = await window
    .locator(".statistics-trend-controls button")
    .count();
  const statisticsTrendRangeCount = await window
    .locator(".statistics-trend-range-controls button")
    .count();
  console.log("statistics-trend-metric-count", statisticsTrendMetricCount);
  console.log("statistics-trend-range-count", statisticsTrendRangeCount);
  await window.getByRole("button", { name: "单次均里程", exact: true }).click();
  const averageRideTrendVisible = await window
    .locator(`[aria-label="${qaCurrentYear}年月度平均单次里程图"]`)
    .isVisible();
  console.log("statistics-average-ride-trend", averageRideTrendVisible);
  await window.getByRole("button", { name: "平均能耗", exact: true }).click();
  const efficiencyTrendVisible = await window
    .locator(`[aria-label="${qaCurrentYear}年月度平均能耗图"]`)
    .isVisible();
  console.log("statistics-efficiency-trend", efficiencyTrendVisible);
  await window.getByRole("button", { name: "近12月", exact: true }).click();
  const rollingTrendVisible = await window
    .locator('[aria-label="近12个月月度平均能耗图"]')
    .isVisible();
  const rollingBars = window.locator(".statistics-bars .statistics-bar-column");
  const rollingStartDate = new Date(qaCurrentYear, qaCurrentMonth - 12, 1);
  const rollingStartName = `${rollingStartDate.getFullYear()}年${rollingStartDate.getMonth() + 1}月`;
  const rollingStartVisible =
    (await rollingBars.first().getAttribute("aria-label"))?.includes(rollingStartName) === true;
  const rollingBarCount = await rollingBars.count();
  const rollingToggleDidNotLoad = (await window.locator(".statistics-progress").count()) === 0;
  console.log(
    "statistics-rolling-trend",
    rollingTrendVisible,
    rollingBarCount,
    rollingStartVisible,
    rollingToggleDidNotLoad,
  );
  await window.locator(".statistics-chart-card").scrollIntoViewIfNeeded();
  await captureCssPixels("statistics-rolling-trends.png");
  await window.getByRole("button", { name: "自然年", exact: true }).click();
  if (
    statisticsTrendMetricCount !== 6 ||
    statisticsTrendRangeCount !== 2 ||
    !averageRideTrendVisible ||
    !efficiencyTrendVisible ||
    !rollingTrendVisible ||
    rollingBarCount !== 12 ||
    !rollingStartVisible ||
    !rollingToggleDidNotLoad
  ) {
    throw new Error("Statistics monthly trend metrics are incomplete");
  }
  await window.locator(".statistics-chart-card").scrollIntoViewIfNeeded();
  await captureCssPixels("statistics-trends.png");
  await window.getByRole("button", { name: "上一统计年份" }).click();
  console.log(
    "statistics-previous-year",
    await window.locator(".statistics-year-switcher strong").textContent(),
  );
  console.log(
    "statistics-history-floor",
    await window.getByRole("button", { name: "上一统计年份" }).isDisabled(),
  );
  console.log(
    "statistics-empty-activity-state",
    await window.getByText("这一年暂无活动记录", { exact: true }).isVisible(),
  );
  await window.getByRole("button", { name: "下一统计年份" }).click();
  await window.waitForFunction(
    (year) =>
      document.querySelector(".statistics-year-switcher strong")?.textContent === `${year}年`,
    qaCurrentYear,
  );
  await captureCssPixels("statistics-dashboard.png");
  await app.evaluate(({ dialog }, exportPath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath });
  }, qaYearExportPath);
  await window.getByRole("button", { name: "导出摘要" }).click();
  console.log(
    "year-export-dialog",
    await window.getByRole("dialog", { name: "选择年度导出格式" }).isVisible(),
  );
  console.log(
    "year-export-format-count",
    await window.locator(".year-summary-export-options button").count(),
  );
  console.log(
    "year-export-privacy-warning",
    await window.getByText(/不包含 GPS 坐标、轨迹点、车辆 SN/).isVisible(),
  );
  await captureCssPixels("year-summary-export.png");
  await window.getByRole("button", { name: /JSON 数据/ }).click();
  await window.getByRole("dialog", { name: "选择年度导出格式" }).waitFor({ state: "hidden" });
  const exportedYearSummary = JSON.parse(await readFile(qaYearExportPath, "utf8"));
  const exportedYearText = JSON.stringify(exportedYearSummary);
  console.log("year-export-months", exportedYearSummary.months.length);
  console.log("year-export-days", exportedYearSummary.months[0]?.days.length ?? 0);
  console.log(
    "year-export-derived-summary",
    exportedYearSummary.schemaVersion === 2 &&
      typeof exportedYearSummary.coverage.averageRideKm === "number" &&
      (exportedYearSummary.coverage.averageEnergyWhPerKm === null ||
        typeof exportedYearSummary.coverage.averageEnergyWhPerKm === "number") &&
      exportedYearSummary.months.every(
        (item) =>
          typeof item.averageRideKm === "number" &&
          (item.averageEnergyWhPerKm === null || typeof item.averageEnergyWhPerKm === "number"),
      ),
  );
  console.log(
    "year-export-sensitive-fields-absent",
    !/longitude|latitude|track|vehicleId|travel_id|"id"/i.test(exportedYearText),
  );
  if (
    exportedYearSummary.schemaVersion !== 2 ||
    typeof exportedYearSummary.coverage.averageRideKm !== "number" ||
    exportedYearSummary.months.length !== qaCurrentMonth ||
    exportedYearSummary.months.some((item) => item.days.length < 28) ||
    /longitude|latitude|track|vehicleId|travel_id|"id"/i.test(exportedYearText)
  ) {
    throw new Error("Annual summary export is incomplete or contains sensitive fields");
  }
  await window.locator(".statistics-bar-column:not(:disabled)").last().click();
  await window.getByText("选择一条行程查看轨迹", { exact: true }).waitFor();
  const chartDetailDeferred = (await window.locator(".playback-panel").count()) === 0;
  console.log("statistics-chart-detail-deferred", chartDetailDeferred);
  if (!chartDetailDeferred) {
    throw new Error("Monthly trend navigation loaded GPS detail before ride selection");
  }
  await window.getByRole("button", { name: "统计", exact: true }).click();
  await window.waitForSelector(".statistics-dashboard");
  await window.locator(".statistics-month-row:not(:disabled)").last().click();
  await window.getByText("选择一条行程查看轨迹", { exact: true }).waitFor();
  const monthRowDetailDeferred = (await window.locator(".playback-panel").count()) === 0;
  console.log("statistics-month-row-detail-deferred", monthRowDetailDeferred);
  if (!monthRowDetailDeferred) {
    throw new Error("Monthly summary navigation loaded GPS detail before ride selection");
  }
  await window.getByRole("button", { name: "统计", exact: true }).click();
  await window.waitForSelector(".statistics-dashboard");
  await window.locator(".year-activity-grid .year-activity-day-active").last().click();
  await window.getByText("选择一条行程查看轨迹", { exact: true }).waitFor();
  console.log("statistics-day-detail-deferred", await window.locator(".playback-panel").count());
  if ((await window.locator(".playback-panel").count()) !== 0) {
    throw new Error("Activity heatmap navigation loaded GPS detail before ride selection");
  }
  await window.locator(".ride-row").first().click();
  await window.waitForSelector(".playback-panel");
  console.log("statistics-day-opens-month", true);
  await window.waitForSelector(".playback-panel");

  await window.getByRole("button", { name: qaCurrentMonthLabel }).click();
  console.log("month-picker-visible", await window.locator(".month-picker").isVisible());
  console.log("month-picker-year", await window.locator(".month-picker-year strong").textContent());
  console.log(
    "month-history-boundary",
    await window.getByText(/数据从 \d{4}年\d+月 开始/).isVisible(),
  );
  if (qaCurrentMonth < 12) {
    console.log(
      "future-month-disabled",
      await window.getByRole("button", { name: `${qaCurrentMonth + 1}月` }).isDisabled(),
    );
  }
  await captureCssPixels("month-picker.png");
  if (qaPreviousYear < qaCurrentYear) {
    await window.getByRole("button", { name: "上一年" }).click();
  }
  await window.getByRole("button", { name: `${qaPreviousMonth}月` }).click();
  console.log(
    "empty-previous-month",
    await window.getByText(`${qaPreviousYear}年${qaPreviousMonth}月没有行程`).isVisible(),
  );
  await captureCssPixels("empty-month.png");
  await window.getByRole("button", { name: `${qaPreviousYear}年${qaPreviousMonth}月` }).click();
  if (qaPreviousYear < qaCurrentYear) {
    await window.getByRole("button", { name: "下一年" }).click();
  }
  await window.getByRole("button", { name: `${qaCurrentMonth}月` }).click();
  await window.waitForSelector(".playback-panel");

  await window.locator(".ride-row").nth(1).click();
  console.log(
    "selected-second-ride",
    await window
      .locator(".ride-row")
      .nth(1)
      .evaluate((element) => element.classList.contains("ride-row-active")),
  );
  const rideEnergyText = await window.locator(".ride-energy-metrics").textContent();
  const rideEnergyVisible =
    rideEnergyText?.includes("231") === true &&
    rideEnergyText.includes("4.0") &&
    rideEnergyText.includes("平均能耗") &&
    rideEnergyText.includes("Wh/km");
  console.log("ride-energy-visible", rideEnergyVisible);
  if (!rideEnergyVisible) throw new Error("Ride energy metrics are missing from the detail panel");
  const rideDayContextText = await window.locator(".ride-day-context").textContent();
  const rideDayContextVisible =
    rideDayContextText?.includes("骑行日累计") === true &&
    rideDayContextText.includes("8.3 km") &&
    rideDayContextText.includes("本次占当天 100.0%");
  console.log("ride-day-context", rideDayContextVisible);
  if (!rideDayContextVisible) throw new Error("Ride day context is missing from the detail panel");
  console.log(
    "detail-refresh-disabled-in-demo",
    await window.getByRole("button", { name: "刷新当前行程" }).isDisabled(),
  );

  const speedZoneOptions = window.locator(".speed-zone-options button");
  console.log("speed-zone-count", await speedZoneOptions.count());
  const speedZonePercentageTotal = await window
    .locator(".speed-zone-options strong")
    .evaluateAll((elements) =>
      elements.reduce((total, element) => total + Number.parseInt(element.textContent ?? "0"), 0),
    );
  console.log(
    "speed-zone-percentage-total",
    speedZonePercentageTotal >= 98 && speedZonePercentageTotal <= 102,
  );
  const fastZone = window.getByRole("button", { name: /定位到 45–60 km\/h 区间最快点/ });
  console.log("speed-zone-fast-enabled", await fastZone.isEnabled());
  await fastZone.click();
  console.log("speed-zone-seek-active", (await fastZone.getAttribute("aria-pressed")) === "true");
  await fastZone.focus();
  await captureCssPixels("speed-zones.png");

  await window.locator(".timeline-range").fill("11.5");
  const comparisonReturnPosition = await window.locator(".timeline-range").inputValue();
  await window.getByRole("button", { name: "对比当前行程" }).click();
  await window.waitForSelector(".ride-comparison-dashboard");
  const comparisonMetricCount = await window.locator(".ride-comparison-metric-row").count();
  const comparisonZoneCount = await window.locator(".ride-comparison-zone-row").count();
  const comparisonCandidateCount = await window
    .locator(".ride-comparison-picker select option")
    .count();
  console.log("comparison-metric-count", comparisonMetricCount);
  console.log("comparison-zone-count", comparisonZoneCount);
  console.log("comparison-candidate-count", comparisonCandidateCount);
  console.log(
    "comparison-historical-speed-rule",
    await window.getByText(/历史摘要若固定为 25 km\/h/).isVisible(),
  );
  const comparisonEnergyVisible =
    (await window.getByText("本次能耗", { exact: true }).count()) === 1 &&
    (await window.getByText("电量消耗", { exact: true }).count()) === 1 &&
    (await window.getByText("平均能耗", { exact: true }).count()) === 1;
  console.log("comparison-energy-visible", comparisonEnergyVisible);
  if (
    comparisonMetricCount !== 7 ||
    comparisonZoneCount !== 5 ||
    comparisonCandidateCount !== 6 ||
    !comparisonEnergyVisible
  ) {
    throw new Error("Ride comparison does not expose the expected metrics, zones, or candidates");
  }
  const comparisonOptions = await window
    .locator(".ride-comparison-picker select option")
    .evaluateAll((options) => options.map((option) => option.value));
  const lastComparisonOption = comparisonOptions.at(-1);
  if (!lastComparisonOption) throw new Error("Ride comparison has no selectable candidate");
  await window.locator(".ride-comparison-picker select").selectOption(lastComparisonOption);
  console.log(
    "comparison-candidate-switch",
    (await window.locator(".ride-comparison-picker select").inputValue()) === lastComparisonOption,
  );
  await captureCssPixels("ride-comparison.png");
  await window.getByRole("button", { name: "返回轨迹" }).click();
  await window.waitForSelector(".playback-panel");
  console.log(
    "comparison-return-preserves-playback",
    (await window.locator(".timeline-range").inputValue()) === comparisonReturnPosition,
  );

  const speedChart = window.getByRole("slider", { name: "速度曲线定位" });
  console.log(
    "chart-duration-synchronized",
    (await speedChart.getAttribute("aria-valuemax")) === "1087",
  );
  await speedChart.focus();
  await speedChart.press("End");
  const chartEndPosition = Number(await window.locator(".timeline-range").inputValue());
  const chartMaximumPosition = Number(await window.locator(".timeline-range").getAttribute("max"));
  console.log("chart-keyboard-end", chartEndPosition === chartMaximumPosition);
  await speedChart.press("Home");
  console.log(
    "chart-keyboard-home",
    (await window.locator(".timeline-range").inputValue()) === "0",
  );
  await speedChart.press("Shift+ArrowRight");
  console.log(
    "chart-keyboard-large-step",
    (await window.locator(".timeline-range").inputValue()) === "5",
  );
  const chartBounds = await speedChart.boundingBox();
  if (!chartBounds) throw new Error("Speed chart is not measurable");
  await window.mouse.click(
    chartBounds.x + chartBounds.width * 0.75,
    chartBounds.y + chartBounds.height / 2,
  );
  const pointerPositionRatio =
    Number(await window.locator(".timeline-range").inputValue()) / chartMaximumPosition;
  console.log("chart-pointer-seek", Math.abs(pointerPositionRatio - 0.75) < 0.02);
  await speedChart.focus();
  await captureCssPixels("speed-chart-focus.png");
  await speedChart.press("Home");

  await window.getByRole("button", { name: "回放速度 1 倍" }).click();
  console.log(
    "playback-rate-menu",
    await window.getByRole("listbox", { name: "选择回放速度" }).isVisible(),
  );
  console.log("playback-rate-options", await window.getByRole("option").count());
  await captureCssPixels("playback-rate-menu.png");
  await window.getByRole("option", { name: "2×" }).click();
  console.log(
    "playback-rate-selected",
    await window.getByRole("button", { name: "回放速度 2 倍" }).isVisible(),
  );

  const timeBefore = await window.locator(".playback-panel .tabular-nums").first().textContent();
  const hasOnlineMarker = (await window.locator(".map-playback-marker").count()) > 0;
  const markerBefore = hasOnlineMarker
    ? await window.locator(".map-playback-marker").getAttribute("style")
    : null;
  await window.getByRole("button", { name: "开始回放" }).click();
  const { markerSamples, progressSamples } = await window.evaluate(
    ({ count, intervalMilliseconds }) =>
      new Promise((resolveSamples) => {
        const markers = [];
        const progressValues = [];
        const timer = window.setInterval(() => {
          markers.push(document.querySelector(".map-playback-marker")?.getAttribute("style"));
          progressValues.push(document.querySelector(".timeline-range")?.value);
          if (progressValues.length >= count) {
            window.clearInterval(timer);
            resolveSamples({ markerSamples: markers, progressSamples: progressValues });
          }
        }, intervalMilliseconds);
      }),
    { count: 10, intervalMilliseconds: 50 },
  );
  await window.getByRole("button", { name: "暂停回放" }).click();
  const timeAfter = await window.locator(".playback-panel .tabular-nums").first().textContent();
  const markerAfter = hasOnlineMarker
    ? await window.locator(".map-playback-marker").getAttribute("style")
    : null;
  console.log("playback-advanced", timeBefore, "=>", timeAfter);
  console.log("map-marker-advanced", hasOnlineMarker ? markerBefore !== markerAfter : "fallback");
  console.log("smooth-marker-frames", hasOnlineMarker ? new Set(markerSamples).size : "fallback");
  console.log("smooth-progress-frames", new Set(progressSamples).size);
  if (hasOnlineMarker && new Set(markerSamples).size < 7) {
    throw new Error("Map marker did not produce enough continuous playback frames");
  }
  if (new Set(progressSamples).size < 7) {
    throw new Error("Timeline did not produce enough continuous playback frames");
  }

  await window.locator(".timeline-range").fill("74");
  console.log("scrubbed-speed", await window.getByText("当前速度").locator("..").textContent());

  await app.evaluate(({ dialog }, exportPath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath });
  }, qaExportPath);
  await window.getByRole("button", { name: "导出当前行程" }).click();
  console.log(
    "export-dialog",
    await window.getByRole("dialog", { name: "选择文件格式" }).isVisible(),
  );
  console.log("export-format-count", await window.locator(".ride-export-options button").count());
  console.log(
    "export-privacy-warning",
    await window.getByText(/精确经纬度、时间、逐点速度.*行程能耗.*骑行日里程/).isVisible(),
  );
  await captureCssPixels("ride-export.png");
  await window.getByRole("button", { name: /JSON 数据/ }).click();
  await window.getByRole("dialog", { name: "选择文件格式" }).waitFor({ state: "hidden" });
  const exportedRide = JSON.parse(await readFile(qaExportPath, "utf8"));
  const exportedRideContextValid =
    exportedRide.schemaVersion === 2 && exportedRide.ride.dayMileageKm === 8.3;
  console.log("export-saved", exportedRideContextValid);
  console.log("export-track-points", exportedRide.ride.track.length);
  console.log(
    "export-energy-metadata",
    exportedRide.ride.energyWh === 231 && exportedRide.ride.batteryUsedPercent === 4,
  );
  console.log("export-internal-id-absent", !Object.hasOwn(exportedRide.ride, "id"));
  if (!exportedRideContextValid || Object.hasOwn(exportedRide.ride, "id")) {
    throw new Error("Ride export schema v2 is incomplete or leaks the internal ride id");
  }
  console.log("export-path-hidden", await window.getByText("已导出 ride-export.json").isVisible());

  const labelsButton = window.getByRole("button", { name: "隐藏地图标注" });
  console.log("labels-before", await labelsButton.getAttribute("aria-pressed"));
  await labelsButton.click();
  console.log(
    "labels-hidden",
    await window.getByRole("button", { name: "显示地图标注" }).getAttribute("aria-pressed"),
  );
  await window.getByRole("button", { name: "显示地图标注" }).click();
  await window.getByRole("button", { name: "显示完整轨迹" }).click();

  await window.getByRole("button", { name: "连接九号账号" }).click();
  console.log(
    "login-dialog",
    await window.getByRole("dialog", { name: "连接九号账号" }).isVisible(),
  );
  console.log("login-warning", await window.getByText(/ninecli 0\.1\.7/).isVisible());
  console.log(
    "password-login-default",
    await window.getByRole("tab", { name: "密码登录" }).getAttribute("aria-selected"),
  );
  await window.getByRole("tab", { name: "短信验证码" }).click();
  console.log(
    "sms-login-selected",
    await window.getByRole("tab", { name: "短信验证码" }).getAttribute("aria-selected"),
  );
  console.log(
    "sms-send-disabled-empty",
    await window.getByRole("button", { name: "发送验证码" }).isDisabled(),
  );
  await window.getByRole("textbox", { name: "手机号" }).fill("13800138000");
  console.log(
    "sms-send-enabled-valid-phone",
    await window.getByRole("button", { name: "发送验证码" }).isEnabled(),
  );
  console.log("sms-verification-boundary", await window.getByText(/不会尝试绕过/).isVisible());
  await captureCssPixels("login-sms.png");
  await window.getByRole("button", { name: "关闭登录" }).click();

  await window.getByRole("button", { name: "设置" }).click();
  await window.getByText("完整性已验证").waitFor({ timeout: 15_000 });
  console.log(
    "security-dialog",
    await window.getByRole("dialog", { name: "运行时安全" }).isVisible(),
  );
  console.log("binary-verified", await window.getByText("完整性已验证").isVisible());
  console.log("command-boundary", await window.getByText("固定白名单").isVisible());
  console.log("session-cache-memory-only", await window.getByText("仅内存").isVisible());
  console.log("controls-hidden", await window.getByText("车辆控制能力未开放").isVisible());
  console.log(
    "account-disconnected",
    await window.getByText("当前未连接九号账号", { exact: true }).isVisible(),
  );
  console.log(
    "logout-disabled-without-token",
    await window.getByRole("button", { name: "退出并清除令牌" }).isDisabled(),
  );
  await captureCssPixels("security.png");
  await window.getByRole("button", { name: "关闭设置" }).click();

  await window.getByRole("button", { name: "开始回放" }).click();
  await window.locator(".ride-row").nth(2).click();
  console.log("rapid-switch-reset", await window.locator(".timeline-range").inputValue());

  await setContentSize(1080, 680);
  await window.getByRole("button", { name: "设备", exact: true }).click();
  await window.waitForSelector(".vehicle-dashboard");
  console.log(
    "minimum-device-scrollable",
    await window.locator(".vehicle-dashboard").evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    })),
  );
  await captureCssPixels("minimum-device-dashboard.png");
  await window.getByRole("button", { name: "地图", exact: true }).click();
  await window.waitForSelector(".location-consent-page");
  await captureCssPixels("minimum-location-consent.png");
  await window.getByRole("button", { name: "统计", exact: true }).click();
  await window.waitForSelector(".statistics-dashboard");
  console.log(
    "minimum-statistics-scrollable",
    await window.locator(".statistics-dashboard").evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    })),
  );
  await captureCssPixels("minimum-statistics-dashboard.png");
  await window.locator(".statistics-dashboard").evaluate((dashboard) => {
    const chart = dashboard.querySelector(".statistics-chart-card");
    if (chart) dashboard.scrollTop = Math.max(0, chart.offsetTop - 20);
  });
  await window.waitForTimeout(180);
  await window.getByRole("button", { name: "近12月", exact: true }).click();
  await window.locator('[aria-label="近12个月月度里程图"]').waitFor();
  await captureCssPixels("minimum-statistics-trends.png");
  await window.getByRole("button", { name: "轨迹", exact: true }).click();
  const minimumShellMetrics = await shellMetrics();
  console.log("minimum-metrics", JSON.stringify(minimumShellMetrics));
  const minimumMetricRegion = minimumShellMetrics.regions[".metrics-panel"];
  const minimumPlaybackRegion = minimumShellMetrics.regions[".playback-panel"];
  if (
    !minimumMetricRegion ||
    !minimumPlaybackRegion ||
    minimumPlaybackRegion.y - minimumMetricRegion.bottom < 8
  ) {
    throw new Error("Minimum window does not preserve spacing between metrics and playback");
  }
  await captureCssPixels("minimum.png");
  await window.getByRole("button", { name: "对比当前行程" }).click();
  await window.waitForSelector(".ride-comparison-dashboard");
  console.log(
    "minimum-comparison-scrollable",
    await window.locator(".ride-comparison-dashboard").evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    })),
  );
  await captureCssPixels("minimum-ride-comparison.png");
  await window.getByRole("button", { name: "返回轨迹" }).click();
  await window.getByRole("button", { name: qaCurrentMonthLabel }).click();
  console.log("minimum-month-picker-visible", await window.locator(".month-picker").isVisible());
  await captureCssPixels("minimum-month-picker.png");
  await window.getByRole("button", { name: qaCurrentMonthLabel }).click();
  await window.getByRole("button", { name: "连接九号账号" }).click();
  console.log(
    "minimum-login-visible",
    await window.getByRole("dialog", { name: "连接九号账号" }).isVisible(),
  );
  await window.getByRole("tab", { name: "短信验证码" }).click();
  console.log(
    "minimum-login-scrollable",
    await window.locator(".login-sheet").evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    })),
  );
  await captureCssPixels("minimum-login-sms.png");
  await window.getByRole("button", { name: "关闭登录" }).click();
  await window.getByRole("button", { name: "设置" }).click();
  await window.getByText("完整性已验证").waitFor({ timeout: 15_000 });
  console.log(
    "minimum-security-visible",
    await window.getByRole("dialog", { name: "运行时安全" }).isVisible(),
  );
  await captureCssPixels("minimum-security.png");
  await window.getByRole("button", { name: "关闭设置" }).click();
  await window.getByRole("button", { name: "导出本月清单" }).click();
  console.log(
    "minimum-month-export-scrollable",
    await window.locator(".ride-export-sheet").evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    })),
  );
  await captureCssPixels("minimum-month-summary-export.png");
  await window.getByRole("button", { name: "关闭月度清单导出" }).click();

  await window.locator(".ride-row").first().click();
  await window.locator(".timeline-range").fill("38");
  await setContentSize(1586, 992);
  await captureCssPixels("hero-repro.png");
  console.log("hero-metrics", JSON.stringify(await shellMetrics()));

  await window.route("https://tiles.openfreemap.org/**", (route) => route.abort());
  await window.reload();
  await window.waitForSelector(".map-fallback-note", { timeout: 12_000 });
  console.log(
    "offline-fallback",
    await window.getByText("在线底图不可用，已保留本地轨迹").isVisible(),
  );
  console.log("offline-speed-legend", await window.locator(".map-speed-legend").isVisible());
  await captureCssPixels("offline-speed-route.png");
  await window.getByRole("button", { name: "地图", exact: true }).click();
  await window.getByRole("button", { name: "查看演示位置" }).click();
  await window.waitForSelector(".location-map-fallback-note", { timeout: 12_000 });
  console.log(
    "offline-location-fallback",
    await window.getByText("在线底图不可用，位置坐标未发送给其他服务").isVisible(),
  );
} finally {
  await app.close();
  await rm(qaUserDataDirectory, { recursive: true, force: true });
}
