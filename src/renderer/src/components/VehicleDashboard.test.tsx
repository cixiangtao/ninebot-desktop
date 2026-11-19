import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { VehicleSnapshot, VehicleSummary } from "../../../shared/contracts";
import { demoVehicle, demoVehicleSnapshot } from "../data/demo";
import { VehicleDashboard } from "./VehicleDashboard";

const renderDashboard = (snapshot: VehicleSnapshot, vehicle: VehicleSummary = demoVehicle) =>
  renderToStaticMarkup(
    <VehicleDashboard
      vehicle={vehicle}
      snapshot={snapshot}
      live
      loading={false}
      error={null}
      updatedAt={null}
      autoRefreshEnabled={false}
      monitorEvent={null}
      onAutoRefreshChange={() => undefined}
      onRefresh={() => undefined}
      onConnect={() => undefined}
    />,
  );

describe("VehicleDashboard battery provenance", () => {
  it("labels a status-domain fallback when battery diagnostics are unavailable", () => {
    const markup = renderDashboard({
      ...demoVehicleSnapshot,
      availability: { status: true, battery: false },
      batteryPercent: 64,
      batteryPercentSource: "status",
      statusBatteryPercent: 64,
      diagnosticBatteryPercent: null,
      batteryChemistry: null,
      batteryPacks: [],
    });

    expect(markup).toContain("64");
    expect(markup).toContain("剩余电量 · 车辆状态回退");
    expect(markup).toContain("电池诊断暂时不可用");
  });

  it("exposes a material disagreement while preferring the diagnostic reading", () => {
    const markup = renderDashboard({
      ...demoVehicleSnapshot,
      batteryPercent: 61,
      batteryPercentSource: "battery",
      statusBatteryPercent: 54,
      diagnosticBatteryPercent: 61,
    });

    expect(markup).toContain("诊断 61% · 状态 54%");
    expect(markup).toContain("两个只读接口返回的电量相差至少 5 个百分点");
  });

  it("uses relationship-specific lifecycle copy without inventing missing dates", () => {
    const sharedMarkup = renderDashboard(demoVehicleSnapshot, {
      ...demoVehicle,
      access: "shared",
      activationTime: 1_704_067_200,
      authorizationTime: 1_738_281_600,
    });
    const inactiveMarkup = renderDashboard(demoVehicleSnapshot, {
      ...demoVehicle,
      activated: false,
      activationTime: null,
      authorizationTime: null,
    });

    expect(sharedMarkup).toContain("获得共享权限");
    expect(sharedMarkup).not.toContain("2024");
    expect(inactiveMarkup).toContain("尚未激活");
  });

  it("does not present the list's zero days as an expiry when status reports an active service", () => {
    const markup = renderDashboard(
      { ...demoVehicleSnapshot, smartServiceExpired: false },
      { ...demoVehicle, smartServiceRemainingDays: 0 },
    );

    expect(markup).toContain("智能服务有效 · 剩余天数暂不可用");
    expect(markup).not.toContain("智能服务剩余 0 天");
    expect(markup).not.toContain("智能服务已到期");
  });

  it("keeps a zero-day list value inconclusive without a current expiry status", () => {
    const markup = renderDashboard(
      { ...demoVehicleSnapshot, smartServiceExpired: null },
      { ...demoVehicle, smartServiceRemainingDays: 0 },
    );

    expect(markup).toContain("智能服务剩余天数暂不可用");
    expect(markup).not.toContain("智能服务剩余 0 天");
    expect(markup).not.toContain("智能服务有效");
    expect(markup).not.toContain("智能服务已到期");
  });

  it("shows reported positive days and gives an explicit expiry status precedence", () => {
    const vehicle = { ...demoVehicle, smartServiceRemainingDays: 42 };
    const activeMarkup = renderDashboard(
      { ...demoVehicleSnapshot, smartServiceExpired: false },
      vehicle,
    );
    const expiredMarkup = renderDashboard(
      { ...demoVehicleSnapshot, smartServiceExpired: true },
      vehicle,
    );

    expect(activeMarkup).toContain("智能服务剩余 42 天");
    expect(expiredMarkup).toContain("智能服务已到期");
    expect(expiredMarkup).not.toContain("智能服务剩余 42 天");
  });

  it("discloses the automatic polling boundary and the latest state transition", () => {
    const markup = renderToStaticMarkup(
      <VehicleDashboard
        vehicle={demoVehicle}
        snapshot={demoVehicleSnapshot}
        live
        loading={false}
        error={null}
        updatedAt={1_700_000_000_000}
        autoRefreshEnabled
        monitorEvent={{
          observedAt: 1_700_000_000_000,
          source: "automatic",
          hasComparison: true,
          changes: [
            {
              id: "battery-percent",
              label: "剩余电量",
              previousValue: "79%",
              currentValue: "78%",
            },
          ],
        }}
        onAutoRefreshChange={() => undefined}
        onRefresh={() => undefined}
        onConnect={() => undefined}
      />,
    );

    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain("每 60 秒刷新；离开设备页或隐藏窗口时暂停");
    expect(markup).toContain("79%");
    expect(markup).toContain("78%");
  });

  it("marks a successful first monitored read as a completed baseline", () => {
    const markup = renderToStaticMarkup(
      <VehicleDashboard
        vehicle={demoVehicle}
        snapshot={demoVehicleSnapshot}
        live
        loading={false}
        error={null}
        updatedAt={1_700_000_000_000}
        autoRefreshEnabled
        monitorEvent={{
          observedAt: 1_700_000_000_000,
          source: "automatic",
          hasComparison: false,
          changes: [],
        }}
        onAutoRefreshChange={() => undefined}
        onRefresh={() => undefined}
        onConnect={() => undefined}
      />,
    );

    expect(markup).toContain("已建立第一份对照状态，等待下一次刷新");
    expect(markup).not.toContain("正在读取第一份对照状态");
  });
});
