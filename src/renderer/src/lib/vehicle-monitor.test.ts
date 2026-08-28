import { describe, expect, it } from "vitest";
import { demoVehicleSnapshot } from "../data/demo";
import {
  createVehicleSnapshotChanges,
  initialVehicleMonitorState,
  shouldRunVehicleMonitor,
  vehicleMonitorReducer,
} from "./vehicle-monitor";

describe("vehicle snapshot monitoring", () => {
  it("summarizes only known user-facing state transitions", () => {
    const changes = createVehicleSnapshotChanges(demoVehicleSnapshot, {
      ...demoVehicleSnapshot,
      batteryPercent: 74,
      locked: false,
      poweredOn: true,
      ignitionOn: true,
      charging: null,
      availability: { status: true, battery: false },
    });

    expect(changes).toEqual([
      {
        id: "battery-availability",
        label: "电池诊断",
        previousValue: "可用",
        currentValue: "不可用",
      },
      {
        id: "battery-percent",
        label: "剩余电量",
        previousValue: "78%",
        currentValue: "74%",
      },
      {
        id: "locked",
        label: "车辆锁",
        previousValue: "已锁定",
        currentValue: "未锁定",
      },
      {
        id: "powered-on",
        label: "主电源",
        previousValue: "未接通",
        currentValue: "已接通",
      },
      {
        id: "ignition-on",
        label: "ACC",
        previousValue: "已关闭",
        currentValue: "已开启",
      },
    ]);
  });

  it("ignores sub-percentage rounding noise and transitions from unknown values", () => {
    const changes = createVehicleSnapshotChanges(
      { ...demoVehicleSnapshot, batteryPercent: 78.2, charging: null },
      { ...demoVehicleSnapshot, batteryPercent: 78.4, charging: true },
    );

    expect(changes).toEqual([]);
  });

  it("runs only for an enabled, visible, idle live device page", () => {
    const ready = {
      enabled: true,
      live: true,
      deviceViewVisible: true,
      documentVisible: true,
      loading: false,
    };

    expect(shouldRunVehicleMonitor(ready)).toBe(true);
    expect(shouldRunVehicleMonitor({ ...ready, enabled: false })).toBe(false);
    expect(shouldRunVehicleMonitor({ ...ready, live: false })).toBe(false);
    expect(shouldRunVehicleMonitor({ ...ready, deviceViewVisible: false })).toBe(false);
    expect(shouldRunVehicleMonitor({ ...ready, documentVisible: false })).toBe(false);
    expect(shouldRunVehicleMonitor({ ...ready, loading: true })).toBe(false);
  });

  it("revokes monitoring and clears the previous event when the vehicle changes", () => {
    const event = {
      observedAt: 1_700_000_000_000,
      source: "automatic" as const,
      hasComparison: true,
      changes: [],
    };
    const activeState = vehicleMonitorReducer(
      vehicleMonitorReducer(initialVehicleMonitorState, { type: "enable" }),
      { type: "record", event },
    );

    expect(vehicleMonitorReducer(activeState, { type: "disable" })).toEqual({
      enabled: false,
      event,
    });
    expect(vehicleMonitorReducer(activeState, { type: "reset" })).toEqual({
      enabled: false,
      event: null,
    });
  });
});
