import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { _electron as electron } from "playwright";

const projectRoot = resolve(import.meta.dirname, "..");
const configuredLivePath = process.env.NINEBOT_LIVE_CONFIG_DIR;
if (!configuredLivePath) {
  throw new Error("NINEBOT_LIVE_CONFIG_DIR must point to an authenticated ninecli config");
}
const legacyConfig = resolve(configuredLivePath);
const qaUserDataDirectory = await mkdtemp(resolve(tmpdir(), "ninebot-desktop-live-qa-"));
const qaExportPath = resolve(qaUserDataDirectory, "live-ride-export.json");
const qaMonthExportPath = resolve(qaUserDataDirectory, "live-month-summary-export.json");
const qaYearExportPath = resolve(qaUserDataDirectory, "live-year-summary-export.json");

const app = await electron.launch({
  args: [".", `--user-data-dir=${qaUserDataDirectory}`],
  cwd: projectRoot,
  env: { ...process.env, NINEBOT_CONFIG_DIR: legacyConfig },
});
const window = await app.firstWindow();
let auditLocationRequests = false;
let locationMapRequestCount = 0;
window.on("request", (request) => {
  if (auditLocationRequests && request.url().startsWith("https://tiles.openfreemap.org/")) {
    locationMapRequestCount += 1;
  }
});

try {
  await window.waitForTimeout(1_000);
  const auth = await window.evaluate(() => window.ninebot?.auth.status());
  console.log("auth", JSON.stringify(auth));
  if (!auth?.ok || !auth.data.connected) throw new Error("Live auth check failed");
  const accountProfile = await window.evaluate(() => window.ninebot?.auth.profile());
  await window.getByRole("button", { name: "重新连接账号", exact: true }).waitFor({
    timeout: 60_000,
  });
  await window.waitForFunction(
    () => document.querySelectorAll(".route-fallback-canvas line[stroke]").length > 0,
  );
  const liveRouteSpeedColors = await window
    .locator(".route-fallback-canvas line[stroke]")
    .evaluateAll((segments) => [
      ...new Set(segments.map((segment) => segment.getAttribute("stroke"))),
    ]);
  await window.waitForFunction(
    () =>
      document.querySelector(".online-map-ready") !== null ||
      document.querySelector(".map-fallback-note") !== null,
    null,
    { timeout: 12_000 },
  );
  const liveCoordinatePreview = {
    available: false,
    shiftMeters: null,
    activated: false,
    sourceRestored: false,
    rideMetricsPreserved: false,
  };
  if ((await window.locator(".online-map-ready").count()) > 0) {
    const sourceControl = window.getByRole("button", {
      name: "启用GCJ-02转WGS84坐标校准预览",
    });
    await sourceControl.waitFor({ timeout: 10_000 });
    liveCoordinatePreview.available = true;
    liveCoordinatePreview.shiftMeters = Number(
      await sourceControl.getAttribute("data-shift-meters"),
    );
    const maximumBefore = await window.locator(".metric-number").textContent();
    const trackSegmentCountBefore = await window
      .locator(".route-fallback-canvas line[stroke]")
      .count();
    await sourceControl.click();
    const activeControl = window.getByRole("button", {
      name: "关闭坐标校准预览并恢复接口原值",
    });
    await activeControl.waitFor({ timeout: 12_000 });
    liveCoordinatePreview.activated =
      (await activeControl.getAttribute("data-coordinate-mode")) === "gcj02-to-wgs84-preview";
    await window.waitForTimeout(1_200);
    await window.screenshot({
      path: resolve(projectRoot, ".impeccable/review/live-coordinate-preview.png"),
    });
    const maximumDuringPreview = await window.locator(".metric-number").textContent();
    const trackSegmentCountDuringPreview = await window
      .locator(".route-fallback-canvas line[stroke]")
      .count();
    liveCoordinatePreview.rideMetricsPreserved =
      maximumBefore === maximumDuringPreview &&
      trackSegmentCountBefore === trackSegmentCountDuringPreview;
    await activeControl.click();
    await sourceControl.waitFor({ timeout: 12_000 });
    liveCoordinatePreview.sourceRestored =
      (await sourceControl.getAttribute("data-coordinate-mode")) === "source";
    await window.waitForTimeout(1_200);
    await window.screenshot({
      path: resolve(projectRoot, ".impeccable/review/live-coordinate-source.png"),
    });
    if (
      !liveCoordinatePreview.activated ||
      !liveCoordinatePreview.sourceRestored ||
      !liveCoordinatePreview.rideMetricsPreserved ||
      liveCoordinatePreview.shiftMeters < 100 ||
      liveCoordinatePreview.shiftMeters > 1_000
    ) {
      throw new Error("Coordinate preview changed ride data or failed its local display contract");
    }
  }
  console.log("live-coordinate-preview", liveCoordinatePreview);

  const vehicles = await window.evaluate(() => window.ninebot?.vehicles.list());
  const firstVehicleId = vehicles?.ok ? vehicles.data[0]?.id : undefined;
  if (!firstVehicleId) throw new Error("Live vehicle list is empty");
  const snapshot = await window.evaluate(
    (vehicleId) => window.ninebot?.vehicles.snapshot({ vehicleId }),
    firstVehicleId,
  );
  const month = new Date().toISOString().slice(0, 7).replace("-", "");
  const rides = await window.evaluate(
    ({ vehicleId, monthValue }) => window.ninebot?.rides.list({ vehicleId, month: monthValue }),
    { vehicleId: firstVehicleId, monthValue: month },
  );
  const firstRideId = rides?.ok ? rides.data.rides[0]?.id : undefined;
  if (!firstRideId) throw new Error("Live ride list is empty");
  const previousMonthDate = new Date();
  previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
  const previousMonth = `${previousMonthDate.getFullYear()}${String(previousMonthDate.getMonth() + 1).padStart(2, "0")}`;
  const previousRides = await window.evaluate(
    ({ vehicleId, monthValue }) => window.ninebot?.rides.list({ vehicleId, month: monthValue }),
    { vehicleId: firstVehicleId, monthValue: previousMonth },
  );
  const previousRideIds = previousRides?.ok ? previousRides.data.rides.map(({ id }) => id) : [];
  const previousSpeedVerification =
    previousRideIds.length > 0
      ? await window.evaluate(
          ({ vehicleId, rideIds }) => window.ninebot?.rides.verifySpeeds({ vehicleId, rideIds }),
          { vehicleId: firstVehicleId, rideIds: previousRideIds },
        )
      : null;
  const previousSpeedVerificationText = JSON.stringify(previousSpeedVerification);
  const previousSpeedVerificationPrivate =
    previousSpeedVerification?.ok === true &&
    previousSpeedVerification.data.rides.length + previousSpeedVerification.data.failedRideCount ===
      previousRideIds.length &&
    !/longitude|latitude|track|travel_id|travelId|vehicleId/i.test(previousSpeedVerificationText);
  const previousSpeedCorrectionCount = previousSpeedVerification?.ok
    ? previousSpeedVerification.data.rides.filter(
        ({ declaredMaxSpeed, sampledMaxSpeed }) =>
          declaredMaxSpeed === 25 &&
          sampledMaxSpeed !== null &&
          Math.abs(sampledMaxSpeed - declaredMaxSpeed) >= 0.5,
      ).length
    : 0;
  const firstPreviousRideId = previousRides?.ok ? previousRides.data.rides[0]?.id : undefined;
  const previousDetail = firstPreviousRideId
    ? await window.evaluate(
        ({ vehicleId, rideId }) => window.ninebot?.rides.detail({ vehicleId, rideId }),
        { vehicleId: firstVehicleId, rideId: firstPreviousRideId },
      )
    : null;
  const currentMonthLabel = `${new Date().getFullYear()}年${new Date().getMonth() + 1}月`;
  await window.getByRole("button", { name: currentMonthLabel, exact: true }).click();
  if (previousMonthDate.getFullYear() < new Date().getFullYear()) {
    await window.getByRole("button", { name: "上一年" }).click();
  }
  await window
    .getByRole("button", { name: `${previousMonthDate.getMonth() + 1}月`, exact: true })
    .click();
  await window.getByText(/旧记录摘要固定返回 25 km\/h，已忽略/).waitFor({ timeout: 60_000 });
  const pendingSpeedPlaceholders = window.locator('.ride-speed-reading[data-source="placeholder"]');
  const pendingSpeedPlaceholderValues = await pendingSpeedPlaceholders
    .locator("strong")
    .allTextContents();
  const historicalPlaceholdersHidden =
    pendingSpeedPlaceholderValues.length > 0 &&
    pendingSpeedPlaceholderValues.every((value) => value.trim() === "—");
  console.log(
    "live-historical-speed-placeholders-hidden",
    historicalPlaceholdersHidden,
    pendingSpeedPlaceholderValues.length,
  );
  if (!historicalPlaceholdersHidden) {
    throw new Error("Historical 25 km/h placeholders are still presented as real maxima");
  }
  await window.screenshot({
    path: resolve(projectRoot, ".impeccable/review/live-speed-verification-pending.png"),
  });
  await window.getByRole("button", { name: "校验全部", exact: true }).click();
  await window
    .getByText(new RegExp(`已校验 ${previousRideIds.length}\\/${previousRideIds.length} 条`))
    .waitFor({
      timeout: 60_000,
    });
  const liveVerifiedRideSpeedCount = await window
    .locator('.ride-speed-reading[data-source="track"]')
    .count();
  const liveCorrectedSpeedCount = await window.locator(".ride-speed-reading-corrected").count();
  const liveSpeedVerificationPrivacyVisible = await window
    .getByText(/页面只接收速度摘要/)
    .isVisible();
  console.log(
    "live-month-speed-verification",
    previousSpeedVerificationPrivate,
    previousSpeedCorrectionCount,
    liveVerifiedRideSpeedCount,
    liveCorrectedSpeedCount,
    liveSpeedVerificationPrivacyVisible,
  );
  if (
    !previousSpeedVerificationPrivate ||
    previousSpeedCorrectionCount < 1 ||
    liveVerifiedRideSpeedCount !== previousRideIds.length ||
    liveCorrectedSpeedCount !== previousSpeedCorrectionCount ||
    !liveSpeedVerificationPrivacyVisible
  ) {
    throw new Error("Live monthly speed verification is incomplete or exposes track details");
  }
  await window.screenshot({
    path: resolve(projectRoot, ".impeccable/review/live-speed-verification.png"),
  });
  await app.evaluate(({ dialog }, exportPath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath });
  }, qaMonthExportPath);
  await window.getByRole("button", { name: "导出本月清单" }).click();
  const liveMonthExportDialog = window.getByRole("dialog", { name: "选择月度导出格式" });
  await liveMonthExportDialog.waitFor();
  const liveMonthExportPrivacyVisible = await liveMonthExportDialog
    .getByText(/不包含 GPS、轨迹点、车辆 SN/)
    .isVisible();
  const liveMonthExportSpeedEvidenceVisible = await liveMonthExportDialog
    .getByText(new RegExp(`已用轨迹校验 ${previousRideIds.length}/${previousRideIds.length} 条`))
    .isVisible();
  await window.screenshot({
    path: resolve(projectRoot, ".impeccable/review/live-month-summary-export.png"),
  });
  await liveMonthExportDialog.getByRole("button", { name: /JSON 数据/ }).click();
  await liveMonthExportDialog.waitFor({ state: "hidden" });
  const exportedMonthSummary = JSON.parse(await readFile(qaMonthExportPath, "utf8"));
  const exportedMonthText = JSON.stringify(exportedMonthSummary);
  const liveMonthExport = {
    schemaVersion: exportedMonthSummary.schemaVersion,
    rideCount: exportedMonthSummary.rides.length,
    verifiedSpeedCount: exportedMonthSummary.coverage.verifiedSpeedCount,
    correctedSpeedCount: exportedMonthSummary.coverage.correctedSpeedCount,
    aggregatePreserved:
      previousRides?.ok === true &&
      exportedMonthSummary.summary.rideCount === previousRides.data.summary.rideCount &&
      exportedMonthSummary.summary.mileageKm === previousRides.data.summary.mileageKm,
    identifiersAbsent:
      exportedMonthSummary.rides.every((ride) => !Object.hasOwn(ride, "id")) &&
      !/longitude|latitude|trail|vehicleId|travel_id|travelId/.test(exportedMonthText),
    privacyVisible: liveMonthExportPrivacyVisible,
    speedEvidenceVisible: liveMonthExportSpeedEvidenceVisible,
  };
  console.log("live-month-export", liveMonthExport);
  if (
    liveMonthExport.schemaVersion !== 1 ||
    liveMonthExport.rideCount !== previousRideIds.length ||
    liveMonthExport.verifiedSpeedCount !== previousRideIds.length ||
    liveMonthExport.correctedSpeedCount !== previousSpeedCorrectionCount ||
    !liveMonthExport.aggregatePreserved ||
    !liveMonthExport.identifiersAbsent ||
    !liveMonthExport.privacyVisible ||
    !liveMonthExport.speedEvidenceVisible
  ) {
    throw new Error("Live month export lost coverage, speed provenance, or privacy boundaries");
  }
  const historicalCapNoticeVisible = await window
    .getByText(/旧记录摘要固定返回 25 km\/h，已忽略/)
    .isVisible();
  const historicalEnergyMetrics = window.locator(".ride-energy-metrics");
  const historicalEnergyMetricsCount = await historicalEnergyMetrics.count();
  const historicalEnergyMetricsText =
    historicalEnergyMetricsCount > 0 ? await historicalEnergyMetrics.textContent() : "";
  const previousMonthEnergyVisible = previousDetail?.ok
    ? previousDetail.data.energyWh === null && previousDetail.data.batteryUsedPercent === null
      ? historicalEnergyMetricsCount === 0
      : historicalEnergyMetricsCount === 1 &&
        (previousDetail.data.energyWh === null ||
          historicalEnergyMetricsText?.includes(previousDetail.data.energyWh.toFixed(0)) ===
            true) &&
        (previousDetail.data.batteryUsedPercent === null ||
          historicalEnergyMetricsText?.includes(
            previousDetail.data.batteryUsedPercent.toFixed(1),
          ) === true)
    : false;
  const previousMonthEfficiencyVisible = previousDetail?.ok
    ? previousDetail.data.energyWh === null || previousDetail.data.mileageKm <= 0
      ? true
      : historicalEnergyMetricsText?.includes("平均能耗") === true &&
        historicalEnergyMetricsText.includes(
          (previousDetail.data.energyWh / previousDetail.data.mileageKm).toFixed(1),
        )
    : false;
  const liveRideDayContext = window.locator(".ride-day-context");
  const liveRideDayContextText =
    (await liveRideDayContext.count()) > 0 ? await liveRideDayContext.textContent() : "";
  const liveRideDayContextVisible = previousDetail?.ok
    ? previousDetail.data.dayMileageKm === null
      ? (await liveRideDayContext.count()) === 0
      : liveRideDayContextText?.includes(previousDetail.data.dayMileageKm.toFixed(1)) === true &&
        liveRideDayContextText.includes("本次占当天")
    : false;
  const liveSpeedChart = window.getByRole("slider", { name: "速度曲线定位" });
  const liveChartDurationSynchronized = previousDetail?.ok
    ? Number(await liveSpeedChart.getAttribute("aria-valuemax")) ===
      previousDetail.data.durationSeconds
    : false;
  await liveSpeedChart.focus();
  await liveSpeedChart.press("End");
  const liveChartKeyboardEnd =
    (await window.locator(".timeline-range").inputValue()) ===
    (await window.locator(".timeline-range").getAttribute("max"));
  const liveChartBounds = await liveSpeedChart.boundingBox();
  if (!liveChartBounds) throw new Error("Live speed chart is not measurable");
  await window.mouse.click(
    liveChartBounds.x + liveChartBounds.width * 0.6,
    liveChartBounds.y + liveChartBounds.height / 2,
  );
  const liveChartPointerRatio =
    Number(await window.locator(".timeline-range").inputValue()) /
    Number(await window.locator(".timeline-range").getAttribute("max"));
  const liveSpeedZoneOptions = window.locator(".speed-zone-options button");
  const liveSpeedZoneCount = await liveSpeedZoneOptions.count();
  const liveSpeedZonePercentageTotal = await window
    .locator(".speed-zone-options strong")
    .evaluateAll((elements) =>
      elements.reduce((total, element) => total + Number.parseInt(element.textContent ?? "0"), 0),
    );
  const liveSpeedZoneLabels = await liveSpeedZoneOptions.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label") ?? ""),
  );
  const liveTrackDistanceKm = liveSpeedZoneLabels.reduce((total, label) => {
    const match = /轨迹里程 ([\d.]+) km/.exec(label);
    return total + Number(match?.[1] ?? 0);
  }, 0);
  const liveFastestZone = window.getByRole("button", {
    name: /定位到 60\+ km\/h 区间最快点/,
  });
  const liveFastestZoneEnabled = await liveFastestZone.isEnabled();
  if (liveFastestZoneEnabled) await liveFastestZone.click();
  const liveFastestZoneActive =
    liveFastestZoneEnabled && (await liveFastestZone.getAttribute("aria-pressed")) === "true";
  const liveTrackDistanceToRideMileageRatio =
    previousDetail?.ok && previousDetail.data.mileageKm > 0
      ? Number((liveTrackDistanceKm / previousDetail.data.mileageKm).toFixed(2))
      : null;
  const comparisonPlaybackPosition = await window.locator(".timeline-range").inputValue();
  await window.getByRole("button", { name: "对比当前行程" }).click();
  await window.waitForSelector(".ride-comparison-dashboard", { timeout: 60_000 });
  await window.waitForSelector(".ride-comparison-metric-row", { timeout: 60_000 });
  const liveComparisonMetricCount = await window.locator(".ride-comparison-metric-row").count();
  const liveComparisonEfficiencyVisible =
    (await window.getByText("平均能耗", { exact: true }).count()) === 1;
  const liveComparisonZoneCount = await window.locator(".ride-comparison-zone-row").count();
  const liveComparisonCandidateCount = await window
    .locator(".ride-comparison-picker select option")
    .count();
  const liveComparisonBaseMaximum = Number.parseFloat(
    (await window
      .locator(".ride-comparison-metric-row")
      .first()
      .locator("span")
      .first()
      .textContent()) ?? "NaN",
  );
  const liveComparisonHistoricalMaximumBypassed =
    previousDetail?.ok === true &&
    liveComparisonBaseMaximum ===
      (previousDetail.data.sampledMaxSpeed ?? previousDetail.data.declaredMaxSpeed ?? 0);
  await window.getByRole("button", { name: "返回轨迹" }).click();
  await window.waitForSelector(".playback-panel");
  const liveComparisonBackPreserved =
    (await window.locator(".timeline-range").inputValue()) === comparisonPlaybackPosition;
  const refreshPlaybackMaximumBefore = Number(
    await window.locator(".timeline-range").getAttribute("max"),
  );
  const refreshPlaybackPositionBefore = Number(
    await window.locator(".timeline-range").inputValue(),
  );
  const activeRideTextBefore = await window.locator(".ride-row-active").textContent();
  await window.getByRole("button", { name: "刷新当前行程" }).click();
  await window.getByText("当前行程已重新读取", { exact: true }).waitFor({ timeout: 60_000 });
  const refreshPlaybackMaximumAfter = Number(
    await window.locator(".timeline-range").getAttribute("max"),
  );
  const refreshPlaybackPositionAfter = Number(await window.locator(".timeline-range").inputValue());
  const activeRideTextAfter = await window.locator(".ride-row-active").textContent();
  const liveDetailRefreshPreserved =
    activeRideTextBefore === activeRideTextAfter &&
    Math.abs(
      refreshPlaybackPositionBefore / refreshPlaybackMaximumBefore -
        refreshPlaybackPositionAfter / refreshPlaybackMaximumAfter,
    ) < 0.001;
  console.log("live-detail-refresh", liveDetailRefreshPreserved);
  if (
    liveSpeedZoneCount !== 5 ||
    liveSpeedZonePercentageTotal < 98 ||
    liveSpeedZonePercentageTotal > 102 ||
    !liveFastestZoneActive ||
    liveTrackDistanceToRideMileageRatio === null ||
    liveTrackDistanceToRideMileageRatio < 0.8 ||
    liveTrackDistanceToRideMileageRatio > 1.2 ||
    liveComparisonMetricCount !== 7 ||
    liveComparisonZoneCount !== 5 ||
    liveComparisonCandidateCount < 1 ||
    !liveComparisonHistoricalMaximumBypassed ||
    !liveComparisonBackPreserved ||
    !liveDetailRefreshPreserved ||
    !previousMonthEnergyVisible ||
    !previousMonthEfficiencyVisible ||
    !liveRideDayContextVisible ||
    !liveComparisonEfficiencyVisible
  ) {
    throw new Error("Live speed-zone or ride-comparison verification failed");
  }
  const detail = await window.evaluate(
    ({ vehicleId, rideId }) => window.ninebot?.rides.detail({ vehicleId, rideId }),
    { vehicleId: firstVehicleId, rideId: firstRideId },
  );
  if (!detail?.ok) throw new Error("Live ride detail is unavailable for export");
  const firstVehicleName = vehicles?.ok ? vehicles.data[0]?.name : undefined;
  if (!firstVehicleName) throw new Error("Live vehicle name is unavailable for export");
  await app.evaluate(({ dialog }, exportPath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath });
  }, qaExportPath);
  const exportResult = await window.evaluate(
    ({ vehicleName, rideDetail }) =>
      window.ninebot?.rides.export({ vehicleName, detail: rideDetail, format: "json" }),
    { vehicleName: firstVehicleName, rideDetail: detail.data },
  );
  const exportedRide = JSON.parse(await readFile(qaExportPath, "utf8"));
  const liveExportEnergyMatches =
    exportedRide.schemaVersion === 2 &&
    exportedRide.ride.energyWh === detail.data.energyWh &&
    exportedRide.ride.batteryUsedPercent === detail.data.batteryUsedPercent &&
    exportedRide.ride.dayMileageKm === detail.data.dayMileageKm;
  if (!liveExportEnergyMatches) throw new Error("Live ride energy export verification failed");

  const currentMonthAggregate = rides?.ok ? rides.data.summary : null;
  const currentVisibleRides = rides?.ok ? rides.data.rides : [];
  const currentRideDays = rides?.ok ? rides.data.days : [];
  const visibleMileageKm = currentVisibleRides.reduce((total, ride) => total + ride.mileageKm, 0);
  const visibleDurationSeconds = currentVisibleRides.reduce(
    (total, ride) => total + ride.durationSeconds,
    0,
  );
  const currentMonthAggregatePreserved =
    currentMonthAggregate?.aggregateAvailable === true &&
    currentMonthAggregate.ridesTruncated === true &&
    currentMonthAggregate.rideCount > currentVisibleRides.length &&
    currentMonthAggregate.mileageKm > visibleMileageKm &&
    currentMonthAggregate.durationSeconds > visibleDurationSeconds;
  const currentDailyMileageKm = currentRideDays.reduce(
    (total, day) => total + (day.mileageKm ?? 0),
    0,
  );
  const currentDailyMileageComplete =
    currentMonthAggregate !== null &&
    currentRideDays.length ===
      new Date(Number(month.slice(0, 4)), Number(month.slice(4)), 0).getDate() &&
    Math.abs(currentDailyMileageKm - currentMonthAggregate.mileageKm) < 0.11 &&
    currentMonthAggregate.activeDayCount ===
      currentRideDays.filter(({ mileageKm }) => mileageKm !== null && mileageKm > 0).length &&
    currentMonthAggregate.longestDayMileageKm ===
      Math.max(0, ...currentRideDays.map(({ mileageKm }) => mileageKm ?? 0));
  const currentRideDayContextComplete = currentVisibleRides.every((ride) => {
    const day = new Date(ride.startTime * 1_000).getDate();
    const completeDayMileageKm = currentRideDays[day - 1]?.mileageKm ?? null;
    return (
      ride.dayMileageKm !== null &&
      completeDayMileageKm !== null &&
      Math.abs(ride.dayMileageKm - completeDayMileageKm) < 0.01 &&
      ride.dayMileageKm + 0.1 >= ride.mileageKm
    );
  });
  const displayedMonthAggregate = previousRides?.ok ? previousRides.data.summary : null;
  const displayedMonthSummaryText = await window.locator(".ride-month-summary").textContent();
  const monthCoverageVisible = displayedMonthAggregate
    ? displayedMonthAggregate.ridesTruncated
      ? displayedMonthSummaryText?.includes(
          `可选择 ${displayedMonthAggregate.visibleRideCount} / ${displayedMonthAggregate.rideCount} 次行程`,
        ) === true
      : displayedMonthSummaryText?.includes("整月汇总 · 明细完整") === true
    : false;
  await window.getByRole("button", { name: "展开骑行日历" }).click();
  const displayedActivityCalendarComplete = previousRides?.ok
    ? (await window.locator(".ride-activity-days button").count()) ===
        previousRides.data.days.length &&
      (await window.locator(".ride-activity-day-active").count()) ===
        previousRides.data.days.filter(({ mileageKm }) => mileageKm !== null && mileageKm > 0)
          .length
    : false;
  const summaryOnlyDay = window
    .locator('.ride-activity-days button[aria-label*="没有可选择明细"]')
    .first();
  const summaryOnlyDayCount = await summaryOnlyDay.count();
  let summaryOnlyDayStateVisible = true;
  if (summaryOnlyDayCount > 0) {
    await summaryOnlyDay.click();
    summaryOnlyDayStateVisible = await window
      .getByText(/里程已计入整月汇总，但不在九号返回的可选明细中/)
      .isVisible();
    await window.getByRole("button", { name: "显示全部" }).click();
    await window.waitForSelector(".playback-panel", { timeout: 60_000 });
  }
  if (
    !currentMonthAggregatePreserved ||
    !currentDailyMileageComplete ||
    !currentRideDayContextComplete ||
    !monthCoverageVisible ||
    !displayedActivityCalendarComplete ||
    !summaryOnlyDayStateVisible
  ) {
    throw new Error("Complete month aggregate is not preserved in the live ride list");
  }

  const historyStartTime = currentMonthAggregate?.historyStartTime ?? null;
  let monthHistoryBoundaryValid = historyStartTime !== null;
  if (historyStartTime !== null) {
    const historyStartDate = new Date(historyStartTime * 1000);
    const historyStartYear = historyStartDate.getFullYear();
    const historyStartMonthNumber = historyStartDate.getMonth() + 1;
    await window.locator(".month-button").click();
    let displayedPickerYear = Number.parseInt(
      (await window.locator(".month-picker-year strong").textContent()) ?? "0",
    );
    while (displayedPickerYear > historyStartYear) {
      // oxlint-disable-next-line no-await-in-loop
      await window.getByRole("button", { name: "上一年" }).click();
      displayedPickerYear -= 1;
    }
    const startMonthEnabled = await window
      .getByRole("button", { name: `${historyStartMonthNumber}月`, exact: true })
      .isEnabled();
    const previousMonthDisabled =
      historyStartMonthNumber === 1 ||
      (await window
        .getByRole("button", { name: `${historyStartMonthNumber - 1}月`, exact: true })
        .isDisabled());
    monthHistoryBoundaryValid =
      startMonthEnabled &&
      previousMonthDisabled &&
      (await window.getByRole("button", { name: "上一年" }).isDisabled()) &&
      (await window.getByText(/数据从 \d{4}年\d+月 开始/).isVisible());
    await window.locator(".month-button").click();
  }
  if (!monthHistoryBoundaryValid) throw new Error("Month history boundary is not enforced");

  await window.getByRole("button", { name: "统计", exact: true }).click();
  await window.waitForSelector(".statistics-dashboard");
  await window.waitForFunction(
    () => document.querySelector(".statistics-progress") === null,
    null,
    { timeout: 60_000 },
  );
  const liveStatisticsSummaryCardCount = await window.locator(".statistics-summary-card").count();
  const liveStatisticsEnergyVisible =
    (await window
      .locator(".statistics-summary-card")
      .getByText("骑行能耗", { exact: true })
      .count()) === 1 &&
    (await window
      .locator(".statistics-summary-card")
      .getByText("平均能耗", { exact: true })
      .count()) === 1;
  const liveStatisticsActiveDaysVisible =
    (await window.getByText("活跃天数", { exact: true }).count()) === 1;
  const liveStatisticsTruncationVisible =
    (await window.locator(".statistics-month-row i").count()) > 0;
  const liveActivityHeatmapVisible = await window.locator(".year-activity-card").isVisible();
  const liveActivityDayCount = await window
    .locator(".year-activity-grid .year-activity-day-active")
    .count();
  const liveActivityInsightsVisible =
    (await window.getByText("最长连续骑行", { exact: true }).isVisible()) &&
    (await window.getByText("最常骑行", { exact: true }).isVisible());
  let yearlyHistoryBoundaryValid = historyStartTime !== null;
  if (historyStartTime !== null) {
    const historyStartDate = new Date(historyStartTime * 1000);
    const historyStartYear = historyStartDate.getFullYear();
    const historyStartMonthNumber = historyStartDate.getMonth() + 1;
    const currentStatisticsYear = Number(
      (await window.locator(".statistics-year-switcher strong").textContent())?.replace("年", ""),
    );
    if (historyStartYear === currentStatisticsYear - 1) {
      await window.getByRole("button", { name: "上一统计年份" }).click();
      await window.waitForFunction(
        () => document.querySelector(".statistics-progress") === null,
        null,
        {
          timeout: 60_000,
        },
      );
      yearlyHistoryBoundaryValid =
        (await window.getByText("数据起点前", { exact: true }).count()) ===
          historyStartMonthNumber - 1 &&
        (await window.getByRole("button", { name: "上一统计年份" }).isDisabled());
      await window.getByRole("button", { name: "下一统计年份" }).click();
      await window.waitForFunction(
        () => document.querySelector(".statistics-progress") === null,
        null,
        {
          timeout: 60_000,
        },
      );
    }
  }
  if (
    liveStatisticsSummaryCardCount !== 6 ||
    !liveStatisticsEnergyVisible ||
    !liveStatisticsActiveDaysVisible ||
    !liveStatisticsTruncationVisible ||
    !liveActivityHeatmapVisible ||
    liveActivityDayCount < 1 ||
    !liveActivityInsightsVisible ||
    !yearlyHistoryBoundaryValid
  ) {
    throw new Error("Live yearly statistics do not expose complete energy and row coverage");
  }

  await app.evaluate(({ dialog }, exportPath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath });
  }, qaYearExportPath);
  await window.getByRole("button", { name: "导出摘要" }).click();
  await window.getByRole("button", { name: /JSON 数据/ }).click();
  await window.getByRole("dialog", { name: "选择年度导出格式" }).waitFor({ state: "hidden" });
  const liveYearExport = JSON.parse(await readFile(qaYearExportPath, "utf8"));
  const liveYearExportText = JSON.stringify(liveYearExport);
  const liveYearExportValid =
    liveYearExport.schemaVersion === 2 &&
    liveYearExport.year === new Date().getFullYear() &&
    liveYearExport.historyStartTime === historyStartTime &&
    liveYearExport.months.length > 0 &&
    liveYearExport.months.every(
      (item) =>
        item.month.startsWith(String(new Date().getFullYear())) &&
        Array.isArray(item.days) &&
        typeof item.ridesTruncated === "boolean" &&
        typeof item.averageRideKm === "number" &&
        (item.averageEnergyWhPerKm === null || typeof item.averageEnergyWhPerKm === "number"),
    ) &&
    typeof liveYearExport.coverage.averageRideKm === "number" &&
    (liveYearExport.coverage.averageEnergyWhPerKm === null ||
      typeof liveYearExport.coverage.averageEnergyWhPerKm === "number") &&
    !/longitude|latitude|track|vehicleId|travel_id|"id"/i.test(liveYearExportText);
  console.log("live-year-export", liveYearExportValid, liveYearExport.months.length);
  if (!liveYearExportValid) {
    throw new Error("Live annual summary export is incomplete or contains sensitive fields");
  }

  const liveTrendMetricCount = await window.locator(".statistics-trend-controls button").count();
  const liveTrendRangeCount = await window
    .locator(".statistics-trend-range-controls button")
    .count();
  await window.getByRole("button", { name: "单次均里程", exact: true }).click();
  const liveAverageRideTrendVisible = await window
    .locator(`[aria-label="${new Date().getFullYear()}年月度平均单次里程图"]`)
    .isVisible();
  await window.getByRole("button", { name: "平均能耗", exact: true }).click();
  const liveEfficiencyTrendVisible = await window
    .locator(`[aria-label="${new Date().getFullYear()}年月度平均能耗图"]`)
    .isVisible();
  await window.getByRole("button", { name: "近12月", exact: true }).click();
  const liveRollingTrendVisible = await window
    .locator('[aria-label="近12个月月度平均能耗图"]')
    .isVisible();
  const liveRollingBars = window.locator(".statistics-bars .statistics-bar-column");
  const liveNow = new Date();
  const liveRollingStartDate = new Date(liveNow.getFullYear(), liveNow.getMonth() - 11, 1);
  const liveRollingStartName = `${liveRollingStartDate.getFullYear()}年${liveRollingStartDate.getMonth() + 1}月`;
  const liveRollingStartVisible =
    (await liveRollingBars.first().getAttribute("aria-label"))?.includes(liveRollingStartName) ===
    true;
  const liveRollingBarCount = await liveRollingBars.count();
  const liveRollingToggleDidNotLoad = (await window.locator(".statistics-progress").count()) === 0;
  await window.locator(".statistics-bar-column:not(:disabled)").last().click();
  await window.getByText("选择一条行程查看轨迹", { exact: true }).waitFor({ timeout: 60_000 });
  const liveTrendDetailDeferred = (await window.locator(".playback-panel").count()) === 0;
  console.log(
    "live-statistics-trend",
    liveTrendMetricCount,
    liveTrendRangeCount,
    liveAverageRideTrendVisible,
    liveEfficiencyTrendVisible,
    liveRollingTrendVisible,
    liveRollingBarCount,
    liveRollingStartVisible,
    liveRollingToggleDidNotLoad,
    liveTrendDetailDeferred,
  );
  if (
    liveTrendMetricCount !== 6 ||
    liveTrendRangeCount !== 2 ||
    !liveAverageRideTrendVisible ||
    !liveEfficiencyTrendVisible ||
    !liveRollingTrendVisible ||
    liveRollingBarCount !== 12 ||
    !liveRollingStartVisible ||
    !liveRollingToggleDidNotLoad ||
    !liveTrendDetailDeferred
  ) {
    throw new Error("Live monthly trend controls or deferred month navigation failed");
  }
  await window.getByRole("button", { name: "统计", exact: true }).click();
  await window.waitForSelector(".statistics-dashboard", { timeout: 60_000 });
  await window.waitForSelector(".year-activity-grid .year-activity-day-active", {
    timeout: 60_000,
  });

  await window.locator(".year-activity-grid .year-activity-day-active").last().click();
  await window.getByText("选择一条行程查看轨迹", { exact: true }).waitFor({ timeout: 60_000 });
  const liveHeatmapDetailDeferred = (await window.locator(".playback-panel").count()) === 0;
  console.log("live-statistics-detail-deferred", liveHeatmapDetailDeferred);
  if (!liveHeatmapDetailDeferred) {
    throw new Error("Live activity heatmap navigation loaded GPS detail before ride selection");
  }
  await window.getByRole("button", { name: "刷新行程" }).click();
  await window.getByText("选择一条行程查看轨迹", { exact: true }).waitFor({ timeout: 60_000 });
  const liveRefreshDetailDeferred = (await window.locator(".playback-panel").count()) === 0;
  console.log("live-statistics-refresh-detail-deferred", liveRefreshDetailDeferred);
  if (!liveRefreshDetailDeferred) {
    throw new Error("Refreshing a heatmap-selected month loaded GPS detail before ride selection");
  }
  await window.locator(".ride-row").first().click();
  await window.waitForSelector(".playback-panel", { timeout: 60_000 });
  console.log("live-statistics-day-opens-month", true);

  await window.getByRole("button", { name: "设备", exact: true }).click();
  await window.waitForSelector(".vehicle-dashboard");
  await window.waitForFunction(() => document.querySelectorAll(".battery-pack-card").length > 0);
  await window.waitForFunction(
    () => document.querySelectorAll(".vehicle-range-comparison p").length >= 2,
  );
  const liveBatteryPackCards = await window.locator(".battery-pack-card").count();
  const liveRangeEstimateCards = await window.locator(".vehicle-range-comparison p").count();
  const liveVehicleContextText = await window
    .locator(".vehicle-dashboard-header > div > p:last-child")
    .textContent();
  const firstVehicle = vehicles?.ok ? vehicles.data[0] : null;
  const expectedLifecycleText = firstVehicle
    ? firstVehicle.activated === false
      ? "尚未激活"
      : firstVehicle.access === "shared" && firstVehicle.authorizationTime !== null
        ? "获得共享权限"
        : firstVehicle.activationTime !== null || firstVehicle.activated === true
          ? "激活"
          : null
    : null;
  const liveVehicleLifecycleVisible =
    expectedLifecycleText === null ||
    liveVehicleContextText?.includes(expectedLifecycleText) === true;
  const liveBatterySourceText = await window.locator(".battery-orbit small").textContent();
  const liveBatterySourceVisible = snapshot?.ok
    ? snapshot.data.batteryPercentSource === "battery"
      ? liveBatterySourceText?.includes("诊断") === true
      : snapshot.data.batteryPercentSource === "status"
        ? liveBatterySourceText?.includes("车辆状态回退") === true
        : liveBatterySourceText?.includes("暂无有效电量读数") === true
    : false;
  const livePowerAndAccSeparated =
    (await window.getByText("主电源", { exact: true }).isVisible()) &&
    (await window.getByText("ACC 状态", { exact: true }).isVisible());
  const liveLithiumBatteryVisible =
    snapshot?.ok && snapshot.data.batteryChemistry === "lithium"
      ? (await window.getByText(/组锂电池数据/).count()) === 1
      : true;
  const liveCycleTipVisible = snapshot?.ok
    ? snapshot.data.batteryPacks.every(
        ({ cycleTip }) => cycleTip === null || cycleTip.length > 0,
      ) &&
      (snapshot.data.batteryPacks.some(({ cycleTip }) => cycleTip !== null)
        ? (await window.locator(".battery-cycle-tips p").count()) > 0
        : true)
    : false;
  if (
    !livePowerAndAccSeparated ||
    !liveLithiumBatteryVisible ||
    !liveCycleTipVisible ||
    !liveBatterySourceVisible ||
    !liveVehicleLifecycleVisible
  ) {
    throw new Error("Live vehicle power or battery diagnostics are not represented accurately");
  }
  const vehicleMonitorToggle = window.getByRole("switch", { name: "开启自动状态监看" });
  await vehicleMonitorToggle.click();
  await window.getByRole("switch", { name: "关闭自动状态监看" }).waitFor();
  await window.getByText("状态监看中", { exact: true }).waitFor();
  await window.waitForFunction(
    () =>
      document.querySelectorAll(".vehicle-monitor-changes li").length > 0 ||
      document.querySelector(".vehicle-monitor-stable")?.textContent?.includes("状态未发生变化") ===
        true,
    null,
    { timeout: 60_000 },
  );
  const liveVehicleMonitorBoundaryVisible = await window
    .getByText("每 60 秒刷新；离开设备页或隐藏窗口时暂停", { exact: true })
    .isVisible();
  const liveVehicleMonitorEventVisible =
    (await window.locator(".vehicle-monitor-changes li").count()) > 0 ||
    (await window.getByText(/状态未发生变化/).count()) > 0;
  await window.screenshot({
    path: resolve(projectRoot, ".impeccable/review/live-vehicle-monitor.png"),
  });
  const monitorReviewWindowSize = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.getContentSize(),
  );
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(1080, 680);
  });
  await window.waitForTimeout(250);
  const liveVehicleMonitorMinimumSafe = await window.evaluate(
    () =>
      document.documentElement.scrollWidth === window.innerWidth &&
      document.querySelector(".vehicle-monitor-strip") !== null &&
      document.querySelector(".vehicle-monitor-toggle") !== null,
  );
  await window.screenshot({
    path: resolve(projectRoot, ".impeccable/review/live-vehicle-monitor-minimum.png"),
  });
  if (monitorReviewWindowSize) {
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(size[0], size[1]);
    }, monitorReviewWindowSize);
  }
  await window.waitForTimeout(250);
  await window.getByRole("switch", { name: "关闭自动状态监看" }).click();
  const liveVehicleMonitorStopped =
    (await window
      .getByRole("switch", { name: "开启自动状态监看" })
      .getAttribute("aria-checked")) === "false" &&
    (await window.getByText(/自动读取/).count()) > 0;
  console.log(
    "live-vehicle-monitor",
    liveVehicleMonitorBoundaryVisible,
    liveVehicleMonitorEventVisible,
    liveVehicleMonitorMinimumSafe,
    liveVehicleMonitorStopped,
  );
  if (
    !liveVehicleMonitorBoundaryVisible ||
    !liveVehicleMonitorEventVisible ||
    !liveVehicleMonitorMinimumSafe ||
    !liveVehicleMonitorStopped
  ) {
    throw new Error("Live vehicle monitoring does not expose its polling boundary or latest event");
  }
  await window.getByRole("button", { name: "设置", exact: true }).click();
  await window.waitForSelector(".security-account");
  const runtimeSecurity = await window.evaluate(() => window.ninebot?.runtime.security());
  const sessionCachePolicyVisible = await window.getByText("仅内存", { exact: true }).isVisible();
  const sessionCachePolicyExplicit =
    runtimeSecurity?.ok === true &&
    runtimeSecurity.data.policy.sessionCache.storage === "memory-only" &&
    runtimeSecurity.data.policy.sessionCache.rawResponsesStored === false &&
    runtimeSecurity.data.policy.sessionCache.persistsAcrossRestarts === false &&
    runtimeSecurity.data.policy.sessionCache.manualRefreshBypasses === true;
  if (!sessionCachePolicyVisible || !sessionCachePolicyExplicit) {
    throw new Error("Session cache policy is not represented accurately");
  }
  const accountMaskVisible = await window
    .locator(".security-account strong")
    .evaluate((element) => element.textContent?.includes("*") === true);
  await window.getByRole("button", { name: "关闭设置" }).click();
  auditLocationRequests = true;
  locationMapRequestCount = 0;
  await window.getByRole("button", { name: "地图", exact: true }).click();
  await window.waitForSelector(".location-consent-page");
  await window.waitForTimeout(500);
  const locationConsentOnly = {
    consentVisible: await window.locator(".location-consent-page").isVisible(),
    locationMapCount: await window.locator(".vehicle-location-online").count(),
    newLocationTileRequests: locationMapRequestCount,
  };
  auditLocationRequests = false;

  console.log(
    JSON.stringify({
      connected: true,
      accountProfile: accountProfile?.ok
        ? {
            fieldsMinimal:
              Object.keys(accountProfile.data).toSorted().join(",") ===
              "identifierKind,maskedIdentifier,passwordConfigured",
            identifierKind: accountProfile.data.identifierKind,
            masked: accountProfile.data.maskedIdentifier?.includes("*") === true,
            passwordStateExplicit:
              typeof accountProfile.data.passwordConfigured === "boolean" ||
              accountProfile.data.passwordConfigured === null,
            maskVisibleInSettings: accountMaskVisible,
          }
        : null,
      liveRouteSpeedColorCount: liveRouteSpeedColors.length,
      liveCoordinatePreview,
      vehicleCount: vehicles?.ok ? vehicles.data.length : 0,
      allVehicleIdsOpaque: vehicles?.ok
        ? vehicles.data.every(({ id }) => /^vehicle-\d+$/.test(id))
        : false,
      allVehicleAccessExplicit: vehicles?.ok
        ? vehicles.data.every(({ access }) => access === "owner" || access === "shared")
        : false,
      allSmartServiceDaysExplicit: vehicles?.ok
        ? vehicles.data.every(
            ({ smartServiceRemainingDays }) =>
              smartServiceRemainingDays === null || smartServiceRemainingDays >= 0,
          )
        : false,
      allVehicleLifecycleSafe: vehicles?.ok
        ? vehicles.data.every(
            ({ activated, activationTime, authorizationTime }) =>
              (typeof activated === "boolean" || activated === null) &&
              (activationTime === null || activationTime > 0) &&
              (authorizationTime === null || authorizationTime > 0) &&
              (activationTime === null ||
                authorizationTime === null ||
                authorizationTime >= activationTime),
          )
        : false,
      liveVehicleLifecycleVisible,
      vehicleIdOpaque: /^vehicle-\d+$/.test(firstVehicleId),
      rideIdOpaque: /^ride-\d+$/.test(firstRideId),
      rideCount: rides?.ok ? rides.data.rides.length : 0,
      currentMonthAggregate: currentMonthAggregate
        ? {
            complete: currentMonthAggregate.aggregateAvailable,
            rowsTruncated: currentMonthAggregate.ridesTruncated,
            totalsExceedVisibleRows: currentMonthAggregatePreserved,
            coverageVisible: monthCoverageVisible,
            dailyMileageComplete: currentDailyMileageComplete,
            rideDayContextComplete: currentRideDayContextComplete,
            activityCalendarComplete: displayedActivityCalendarComplete,
            summaryOnlyDayStateVisible,
            activeDayCount: currentMonthAggregate.activeDayCount,
            longestDayMileageKm: currentMonthAggregate.longestDayMileageKm,
            historyStartTime,
            monthHistoryBoundaryValid,
          }
        : null,
      vehicleSnapshot: snapshot?.ok
        ? {
            statusAvailable: snapshot.data.availability.status,
            batteryAvailable: snapshot.data.availability.battery,
            batteryPercent: snapshot.data.batteryPercent,
            batteryPercentSource: snapshot.data.batteryPercentSource,
            statusBatteryPercent: snapshot.data.statusBatteryPercent,
            diagnosticBatteryPercent: snapshot.data.diagnosticBatteryPercent,
            batterySourceVisible: liveBatterySourceVisible,
            aiRangeKm: snapshot.data.aiEstimatedRangeKm,
            standardRangeKm: snapshot.data.estimatedRangeKm,
            preciseRangeKm: snapshot.data.preciseEstimatedRangeKm,
            displayedRangeKm:
              snapshot.data.aiEstimatedRangeKm ??
              snapshot.data.preciseEstimatedRangeKm ??
              snapshot.data.estimatedRangeKm,
            remainingChargeTimePresent: snapshot.data.remainingChargeTimeText !== null,
            locked: snapshot.data.locked,
            poweredOn: snapshot.data.poweredOn,
            ignitionOn: snapshot.data.ignitionOn,
            powerAndAccSeparated: livePowerAndAccSeparated,
            batteryChemistryRecognized:
              snapshot.data.batteryChemistry === "lithium" ||
              snapshot.data.batteryChemistry === null,
            lithiumLabelVisible: liveLithiumBatteryVisible,
            cycleTipVisible: liveCycleTipVisible,
            smartServiceStateExplicit:
              typeof snapshot.data.smartServiceExpired === "boolean" ||
              snapshot.data.smartServiceExpired === null,
            chargeCompletionTimeExplicit:
              snapshot.data.chargeCompletionTime === null || snapshot.data.chargeCompletionTime > 0,
            batteryPackCount: snapshot.data.batteryPacks.length,
            monitorBoundaryVisible: liveVehicleMonitorBoundaryVisible,
            monitorEventVisible: liveVehicleMonitorEventVisible,
            monitorMinimumSafe: liveVehicleMonitorMinimumSafe,
            monitorStopped: liveVehicleMonitorStopped,
          }
        : null,
      previousMonthRideCount: previousRides?.ok ? previousRides.data.rides.length : null,
      previousMonthSpeedEvidence: previousDetail?.ok
        ? {
            declared: previousDetail.data.declaredMaxSpeed,
            sampled: previousDetail.data.sampledMaxSpeed,
            sampleCount: previousDetail.data.track.length,
            historicalCapBypassed:
              previousDetail.data.declaredMaxSpeed === 25 &&
              previousDetail.data.sampledMaxSpeed !== null &&
              previousDetail.data.sampledMaxSpeed !== 25,
          }
        : null,
      previousMonthSpeedVerification: {
        resultPrivate: previousSpeedVerificationPrivate,
        verifiedRideCount: liveVerifiedRideSpeedCount,
        correctedRideCount: liveCorrectedSpeedCount,
        privacyVisible: liveSpeedVerificationPrivacyVisible,
      },
      liveMonthExport,
      previousMonthEnergyEvidence: previousDetail?.ok
        ? {
            energyWhPresent:
              previousDetail.data.energyWh === null || previousDetail.data.energyWh >= 0,
            batteryUsedPercentPresent:
              previousDetail.data.batteryUsedPercent === null ||
              previousDetail.data.batteryUsedPercent >= 0,
            visible: previousMonthEnergyVisible,
            efficiencyVisible: previousMonthEfficiencyVisible,
          }
        : null,
      previousMonthDayContext: previousDetail?.ok
        ? {
            dayMileageKm: previousDetail.data.dayMileageKm,
            visible: liveRideDayContextVisible,
          }
        : null,
      historicalCapNoticeVisible,
      liveChartInteraction: {
        durationSynchronized: liveChartDurationSynchronized,
        keyboardEnd: liveChartKeyboardEnd,
        pointerSeek: Math.abs(liveChartPointerRatio - 0.6) < 0.02,
      },
      liveSpeedZones: {
        count: liveSpeedZoneCount,
        percentageTotalValid:
          liveSpeedZonePercentageTotal >= 98 && liveSpeedZonePercentageTotal <= 102,
        fastestZoneEnabled: liveFastestZoneEnabled,
        fastestZoneActive: liveFastestZoneActive,
        trackDistanceToRideMileageRatio: liveTrackDistanceToRideMileageRatio,
      },
      liveComparison: {
        metricCount: liveComparisonMetricCount,
        zoneCount: liveComparisonZoneCount,
        candidateCount: liveComparisonCandidateCount,
        efficiencyVisible: liveComparisonEfficiencyVisible,
        historicalMaximumBypassed: liveComparisonHistoricalMaximumBypassed,
        backPreserved: liveComparisonBackPreserved,
      },
      liveDetailRefresh: {
        refreshSucceeded: liveDetailRefreshPreserved,
        selectionPreserved: activeRideTextBefore === activeRideTextAfter,
        relativePlaybackPreserved: liveDetailRefreshPreserved,
      },
      currentRideSurvivedMonthSwitch: detail?.ok === true,
      liveBatteryPackCards,
      liveRangeEstimateCards,
      liveYearStatistics: {
        summaryCardCount: liveStatisticsSummaryCardCount,
        energyVisible: liveStatisticsEnergyVisible,
        activeDaysVisible: liveStatisticsActiveDaysVisible,
        truncationVisible: liveStatisticsTruncationVisible,
        activityHeatmapVisible: liveActivityHeatmapVisible,
        activityDayCount: liveActivityDayCount,
        activityInsightsVisible: liveActivityInsightsVisible,
        activityDetailDeferred: liveHeatmapDetailDeferred,
        historyBoundaryValid: yearlyHistoryBoundaryValid,
        trendMetricCount: liveTrendMetricCount,
        trendRangeCount: liveTrendRangeCount,
        averageRideTrendVisible: liveAverageRideTrendVisible,
        efficiencyTrendVisible: liveEfficiencyTrendVisible,
        rollingTrendVisible: liveRollingTrendVisible,
        rollingBarCount: liveRollingBarCount,
        rollingStartVisible: liveRollingStartVisible,
        rollingToggleDidNotLoad: liveRollingToggleDidNotLoad,
      },
      locationConsentOnly,
      sessionCachePolicy: {
        visible: sessionCachePolicyVisible,
        explicit: sessionCachePolicyExplicit,
      },
      detail: detail?.ok
        ? {
            maxSpeed: detail.data.declaredMaxSpeed,
            sampledMaxSpeed: detail.data.sampledMaxSpeed,
            sampleCount: detail.data.track.length,
            energyWhPresent: detail.data.energyWh === null || detail.data.energyWh >= 0,
            batteryUsedPercentPresent:
              detail.data.batteryUsedPercent === null || detail.data.batteryUsedPercent >= 0,
            dayMileageKm: detail.data.dayMileageKm,
          }
        : null,
      liveExport: {
        saved: exportResult?.ok === true && exportResult.data.saved,
        schemaVersion: exportedRide.schemaVersion,
        fileNameOnly:
          exportResult?.ok === true && exportResult.data.fileName === "live-ride-export.json",
        sampleCountMatches: exportedRide.ride.track.length === detail.data.track.length,
        energyMatches: liveExportEnergyMatches,
        dayMileageMatches: exportedRide.ride.dayMileageKm === detail.data.dayMileageKm,
        internalRideIdAbsent: !Object.hasOwn(exportedRide.ride, "id"),
      },
    }),
  );
} finally {
  await app.close();
  await rm(qaUserDataDirectory, { recursive: true, force: true });
}
