import type { VehicleSnapshot } from "../../../shared/contracts";

export const VEHICLE_MONITOR_INTERVAL_MS = 60_000;

export type VehicleSnapshotRefreshSource = "initial" | "manual" | "automatic";

export interface VehicleSnapshotChange {
  id: string;
  label: string;
  previousValue: string;
  currentValue: string;
}

export interface VehicleSnapshotMonitorEvent {
  observedAt: number;
  source: Exclude<VehicleSnapshotRefreshSource, "initial">;
  /** False when this successful read established the first baseline instead of comparing two. */
  hasComparison: boolean;
  changes: VehicleSnapshotChange[];
}

export interface VehicleMonitorState {
  enabled: boolean;
  event: VehicleSnapshotMonitorEvent | null;
}

export type VehicleMonitorAction =
  | { type: "enable" }
  | { type: "disable" }
  | { type: "record"; event: VehicleSnapshotMonitorEvent }
  | { type: "clear-event" }
  | { type: "reset" };

export const initialVehicleMonitorState: VehicleMonitorState = {
  enabled: false,
  event: null,
};

/** Keeps monitor authorization and its latest event consistent across lifecycle transitions. */
export const vehicleMonitorReducer = (
  state: VehicleMonitorState,
  action: VehicleMonitorAction,
): VehicleMonitorState => {
  switch (action.type) {
    case "enable":
      return { enabled: true, event: null };
    case "disable":
      return { ...state, enabled: false };
    case "record":
      return { ...state, event: action.event };
    case "clear-event":
      return { ...state, event: null };
    case "reset":
      return initialVehicleMonitorState;
  }
};

interface VehicleMonitorRunState {
  enabled: boolean;
  live: boolean;
  deviceViewVisible: boolean;
  documentVisible: boolean;
  loading: boolean;
}

const formatBoolean = (value: boolean, enabled: string, disabled: string) =>
  value ? enabled : disabled;

const createBooleanChange = (
  id: string,
  label: string,
  previousValue: boolean | null,
  currentValue: boolean | null,
  enabledText: string,
  disabledText: string,
): VehicleSnapshotChange[] => {
  if (previousValue === null || currentValue === null || previousValue === currentValue) return [];
  return [
    {
      id,
      label,
      previousValue: formatBoolean(previousValue, enabledText, disabledText),
      currentValue: formatBoolean(currentValue, enabledText, disabledText),
    },
  ];
};

/** Summarizes user-meaningful changes between two location-free vehicle snapshots. */
export const createVehicleSnapshotChanges = (
  previousSnapshot: VehicleSnapshot,
  currentSnapshot: VehicleSnapshot,
): VehicleSnapshotChange[] => {
  const changes: VehicleSnapshotChange[] = [];
  const availabilityDomains = [
    {
      id: "status-availability",
      label: "车辆状态",
      previousValue: previousSnapshot.availability.status,
      currentValue: currentSnapshot.availability.status,
    },
    {
      id: "battery-availability",
      label: "电池诊断",
      previousValue: previousSnapshot.availability.battery,
      currentValue: currentSnapshot.availability.battery,
    },
  ];
  for (const domain of availabilityDomains) {
    if (domain.previousValue === domain.currentValue) continue;
    changes.push({
      id: domain.id,
      label: domain.label,
      previousValue: domain.previousValue ? "可用" : "不可用",
      currentValue: domain.currentValue ? "可用" : "不可用",
    });
  }

  const previousBatteryPercent =
    previousSnapshot.batteryPercent === null ? null : Math.round(previousSnapshot.batteryPercent);
  const currentBatteryPercent =
    currentSnapshot.batteryPercent === null ? null : Math.round(currentSnapshot.batteryPercent);
  if (
    previousBatteryPercent !== null &&
    currentBatteryPercent !== null &&
    previousBatteryPercent !== currentBatteryPercent
  ) {
    changes.push({
      id: "battery-percent",
      label: "剩余电量",
      previousValue: `${previousBatteryPercent}%`,
      currentValue: `${currentBatteryPercent}%`,
    });
  }

  changes.push(
    ...createBooleanChange(
      "locked",
      "车辆锁",
      previousSnapshot.locked,
      currentSnapshot.locked,
      "已锁定",
      "未锁定",
    ),
    ...createBooleanChange(
      "powered-on",
      "主电源",
      previousSnapshot.poweredOn,
      currentSnapshot.poweredOn,
      "已接通",
      "未接通",
    ),
    ...createBooleanChange(
      "ignition-on",
      "ACC",
      previousSnapshot.ignitionOn,
      currentSnapshot.ignitionOn,
      "已开启",
      "已关闭",
    ),
    ...createBooleanChange(
      "charging",
      "充电状态",
      previousSnapshot.charging,
      currentSnapshot.charging,
      "充电中",
      "未充电",
    ),
  );

  return changes;
};

/** Keeps automatic ninecli polling scoped to an explicitly enabled, visible device surface. */
export const shouldRunVehicleMonitor = ({
  enabled,
  live,
  deviceViewVisible,
  documentVisible,
  loading,
}: VehicleMonitorRunState) => enabled && live && deviceViewVisible && documentVisible && !loading;
