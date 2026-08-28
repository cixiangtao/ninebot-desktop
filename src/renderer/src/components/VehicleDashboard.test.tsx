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
