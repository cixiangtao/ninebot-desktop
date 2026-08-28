import {
  Bike,
  CalendarDays,
  ChartNoAxesCombined,
  CircleUserRound,
  Download,
  GitCompareArrows,
  LoaderCircle,
  Map as MapIcon,
  Pause,
  Play,
  RefreshCw,
  Route,
  Settings,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type {
  AccountProfile,
  BridgeResult,
  MonthSummaryExportFormat,
  PasswordLoginInput,
  RideDaySummary,
  RideDetail,
  RideExportFormat,
  RideMonthSummary,
  RideSpeedVerification,
  RideSummary,
  RuntimeSecurityStatus,
  SmsCodeLoginInput,
  SmsCodeRequestInput,
  VehicleLocation,
  VehicleLocationPermission,
  VehicleSnapshot,
  VehicleSummary,
  YearSummaryExportFormat,
  YearSummaryExportMonth,
} from "../../shared/contracts";
import { LoginSheet } from "./components/LoginSheet";
import { LocationDashboard } from "./components/LocationDashboard";
import { MonthSummaryExportSheet } from "./components/MonthSummaryExportSheet";
import { MonthNavigator } from "./components/MonthNavigator";
import { PlaybackRateControl } from "./components/PlaybackRateControl";
import { RideComparisonDashboard } from "./components/RideComparisonDashboard";
import { RideActivityCalendar } from "./components/RideActivityCalendar";
import { RideExportSheet } from "./components/RideExportSheet";
import { RideSpeedReading } from "./components/RideSpeedReading";
import { RideSpeedVerificationPanel } from "./components/RideSpeedVerificationPanel";
import { RouteMap } from "./components/RouteMap";
import { SecuritySheet } from "./components/SecuritySheet";
import { SpeedChart } from "./components/SpeedChart";
import { SpeedZoneDistribution } from "./components/SpeedZoneDistribution";
import { StatisticsDashboard } from "./components/StatisticsDashboard";
import { VehicleDashboard } from "./components/VehicleDashboard";
import { VehicleSwitcher } from "./components/VehicleSwitcher";
import { YearSummaryExportSheet } from "./components/YearSummaryExportSheet";
import {
  createDemoDetail,
  demoDetail,
  demoRides,
  demoVehicle,
  demoVehicleLocations,
  demoVehicleLocationPermissions,
  demoVehicleSnapshot,
  demoVehicles,
  demoVehicleSnapshots,
} from "./data/demo";
import {
  calculateRideDayShare,
  calculateRideEnergyEfficiency,
  currentMonth,
  formatDuration,
  formatLongDuration,
  formatMonth,
  formatRideDate,
  getMonthYear,
  getMonthFromUnixSeconds,
  isLikelyCappedMaxSpeedDeclaration,
  resolveDisplayedMaxSpeed,
} from "./lib/format";
import type { CoordinateDisplayMode } from "./lib/coordinate";
import {
  advancePlaybackPosition,
  interpolateTrackPoint,
  remapTrackPosition,
  type PlaybackRate,
} from "./lib/track";
import {
  createVehicleSnapshotChanges,
  initialVehicleMonitorState,
  shouldRunVehicleMonitor,
  VEHICLE_MONITOR_INTERVAL_MS,
  vehicleMonitorReducer,
  type VehicleSnapshotRefreshSource,
} from "./lib/vehicle-monitor";
import {
  createRollingStatisticsMonthKeys,
  createStatisticsMonthKeys,
  summarizeRideRange,
  summarizeYearRides,
  type MonthRideStatistics,
  type YearRideStatistics,
} from "./lib/statistics";

type DataMode = "demo" | "live";
type AppView = "device" | "map" | "rides" | "statistics" | "comparison";

interface LiveDataOptions {
  refresh?: boolean;
  loadFirstRideDetail?: boolean;
}

interface RideSelectionOptions {
  refresh?: boolean;
  preservePlayback?: boolean;
}

type DetailRefreshState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success" }
  | { status: "error"; message: string };

type RideSpeedVerificationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; failedRideCount: number }
  | { status: "error"; message: string };

const PLAYBACK_SEGMENT_DURATION_MS = 180;
const MAX_FRAME_DELTA_MS = 50;
const EMPTY_TRACK: RideDetail["track"] = [];
const STATISTICS_BATCH_SIZE = 3;
const demoHistoryStartTime = Math.floor(
  new Date(new Date().getFullYear() - 1, 0, 1).getTime() / 1000,
);

const unwrap = <T,>(result: BridgeResult<T>) => {
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
};

const createRideSpeedVerification = (detail: RideDetail): RideSpeedVerification => ({
  id: detail.id,
  declaredMaxSpeed: detail.declaredMaxSpeed,
  sampledMaxSpeed: detail.sampledMaxSpeed,
});

/** Creates an internally consistent month aggregate for local demo data. */
const createDemoRideDays = (month: string, rides: RideSummary[]): RideDaySummary[] => {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(4));
  const dayCount = new Date(year, monthNumber, 0).getDate();
  const mileageByDay = Array.from({ length: dayCount }, () => 0);
  for (const [index, ride] of rides.entries()) {
    const rideDate = new Date(ride.startTime * 1000);
    const belongsToMonth =
      rideDate.getFullYear() === year && rideDate.getMonth() + 1 === monthNumber;
    const day = belongsToMonth ? rideDate.getDate() : ((index * 3 + 1) % dayCount) + 1;
    mileageByDay[day - 1] = ride.dayMileageKm ?? (mileageByDay[day - 1] ?? 0) + ride.mileageKm;
  }
  return mileageByDay.map((mileageKm, index) => ({ day: index + 1, mileageKm }));
};

const createDemoMonthSummary = (month: string, rides: RideSummary[]): RideMonthSummary => {
  const days = createDemoRideDays(month, rides);
  return {
    month,
    historyStartTime: demoHistoryStartTime,
    rideCount: rides.length,
    mileageKm: rides.reduce((total, ride) => total + ride.mileageKm, 0),
    durationSeconds: rides.reduce((total, ride) => total + ride.durationSeconds, 0),
    energyWh: rides.every(({ energyWh }) => energyWh !== null)
      ? rides.reduce((total, ride) => total + (ride.energyWh ?? 0), 0)
      : null,
    visibleRideCount: rides.length,
    aggregateAvailable: true,
    ridesTruncated: false,
    activeDayCount: days.filter(({ mileageKm }) => mileageKm !== null && mileageKm > 0).length,
    longestDayMileageKm: Math.max(0, ...days.map(({ mileageKm }) => mileageKm ?? 0)),
  };
};

const createDemoStatisticsSourceMonth = (month: string): YearSummaryExportMonth => {
  const monthNumber = Number(month.slice(4));
  const count = Math.min(demoRides.length, 2 + ((monthNumber * 3) % demoRides.length));
  const monthRides = demoRides.slice(0, count).map((ride, index) => {
    const scale = 0.72 + monthNumber * 0.035;
    return {
      ...ride,
      id: `demo-stat-${month}-${index}`,
      mileageKm: ride.mileageKm * scale,
      energyWh: ride.energyWh === null ? null : ride.energyWh * scale,
      dayMileageKm: ride.dayMileageKm === null ? null : ride.dayMileageKm * scale,
    };
  });
  return {
    summary: createDemoMonthSummary(month, monthRides),
    days: createDemoRideDays(month, monthRides),
  };
};

const createDemoYearMonths = (year: number, referenceMonth: string): YearSummaryExportMonth[] => {
  const referenceYear = Number(referenceMonth.slice(0, 4));
  const referenceMonthNumber = Number(referenceMonth.slice(4));
  const months: YearSummaryExportMonth[] = [];
  if (year === referenceYear) {
    for (let monthNumber = 1; monthNumber <= referenceMonthNumber; monthNumber += 1) {
      const month = `${year}${String(monthNumber).padStart(2, "0")}`;
      months.push(createDemoStatisticsSourceMonth(month));
    }
  }
  return months;
};

const createDemoYearStatistics = (year: number, referenceMonth: string) =>
  summarizeYearRides(
    year,
    new Map(
      createDemoYearMonths(year, referenceMonth).map(({ summary }) => [summary.month, summary]),
    ),
  );

const createDemoRollingStatistics = (referenceMonth: string): MonthRideStatistics[] => {
  const monthKeys = createRollingStatisticsMonthKeys(referenceMonth);
  const summaries = new Map(
    monthKeys.map((month) => {
      const sourceMonth = createDemoStatisticsSourceMonth(month);
      return [month, sourceMonth.summary] as const;
    }),
  );
  return summarizeRideRange(monthKeys, summaries);
};

export default function App() {
  const [mode, setMode] = useState<DataMode>("demo");
  const [view, setView] = useState<AppView>("rides");
  const [vehicles, setVehicles] = useState<VehicleSummary[]>(demoVehicles);
  const [vehicle, setVehicle] = useState<VehicleSummary>(demoVehicle);
  const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
  const [vehicleSnapshot, setVehicleSnapshot] = useState<VehicleSnapshot | null>(
    demoVehicleSnapshot,
  );
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotUpdatedAt, setSnapshotUpdatedAt] = useState<number | null>(null);
  const [snapshotMonitorState, dispatchSnapshotMonitor] = useReducer(
    vehicleMonitorReducer,
    initialVehicleMonitorState,
  );
  const snapshotAutoRefreshEnabled = snapshotMonitorState.enabled;
  const snapshotMonitorEvent = snapshotMonitorState.event;
  const [vehicleLocation, setVehicleLocation] = useState<VehicleLocation | null>(null);
  const [locationPermission, setLocationPermission] =
    useState<VehicleLocationPermission>("unknown");
  const [locationAuthorized, setLocationAuthorized] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationUpdatedAt, setLocationUpdatedAt] = useState<number | null>(null);
  const [coordinateDisplayMode, setCoordinateDisplayMode] =
    useState<CoordinateDisplayMode>("source");
  const [rides, setRides] = useState<RideSummary[]>(demoRides);
  const [rideDays, setRideDays] = useState<RideDaySummary[]>(() =>
    createDemoRideDays(currentMonth(), demoRides),
  );
  const [selectedRideDay, setSelectedRideDay] = useState<number | null>(null);
  const [rideMonthSummary, setRideMonthSummary] = useState<RideMonthSummary>(() =>
    createDemoMonthSummary(currentMonth(), demoRides),
  );
  const [historyStartTime, setHistoryStartTime] = useState<number | null>(demoHistoryStartTime);
  const [detail, setDetail] = useState<RideDetail | null>(demoDetail);
  const [selectedRideId, setSelectedRideId] = useState<string | null>(demoDetail.id);
  const [detailRefreshState, setDetailRefreshState] = useState<DetailRefreshState>({
    status: "idle",
  });
  const [rideSpeedVerifications, setRideSpeedVerifications] = useState<
    Record<string, RideSpeedVerification>
  >(() => ({ [demoDetail.id]: createRideSpeedVerification(demoDetail) }));
  const [rideSpeedVerificationState, setRideSpeedVerificationState] =
    useState<RideSpeedVerificationState>({ status: "idle" });
  const [comparisonDetail, setComparisonDetail] = useState<RideDetail | null>(null);
  const [comparisonRideId, setComparisonRideId] = useState<string | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [playbackPosition, setPlaybackPosition] = useState(38);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1);
  const [loading, setLoading] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityStatus, setSecurityStatus] = useState<RuntimeSecurityStatus | null>(null);
  const [securityError, setSecurityError] = useState<string | null>(null);
  const [accountProfile, setAccountProfile] = useState<AccountProfile | null>(null);
  const [accountProfileError, setAccountProfileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportFormat, setExportFormat] = useState<RideExportFormat | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [monthExportOpen, setMonthExportOpen] = useState(false);
  const [monthExportBusy, setMonthExportBusy] = useState(false);
  const [monthExportFormat, setMonthExportFormat] = useState<MonthSummaryExportFormat | null>(null);
  const [monthExportError, setMonthExportError] = useState<string | null>(null);
  const [monthExportNotice, setMonthExportNotice] = useState<string | null>(null);
  const thisMonth = useMemo(() => currentMonth(), []);
  const currentYear = useMemo(() => Number(thisMonth.slice(0, 4)), [thisMonth]);
  const [statisticsYear, setStatisticsYear] = useState(currentYear);
  const [statistics, setStatistics] = useState<YearRideStatistics | null>(() =>
    createDemoYearStatistics(currentYear, thisMonth),
  );
  const [rollingStatisticsMonths, setRollingStatisticsMonths] = useState<MonthRideStatistics[]>(
    () => createDemoRollingStatistics(thisMonth),
  );
  const [statisticsLoading, setStatisticsLoading] = useState(false);
  const [statisticsProgress, setStatisticsProgress] = useState({ loaded: 0, total: 0 });
  const [statisticsError, setStatisticsError] = useState<string | null>(null);
  const [statisticsSourceMonths, setStatisticsSourceMonths] = useState<YearSummaryExportMonth[]>(
    () => createDemoYearMonths(currentYear, thisMonth),
  );
  const [yearExportOpen, setYearExportOpen] = useState(false);
  const [yearExportBusy, setYearExportBusy] = useState(false);
  const [yearExportFormat, setYearExportFormat] = useState<YearSummaryExportFormat | null>(null);
  const [yearExportError, setYearExportError] = useState<string | null>(null);
  const [yearExportNotice, setYearExportNotice] = useState<string | null>(null);
  const [month, setMonth] = useState(thisMonth);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [monthPickerYear, setMonthPickerYear] = useState(() => getMonthYear(thisMonth));
  const lastFrame = useRef<number | null>(null);
  const playbackPositionRef = useRef(playbackPosition);
  const liveRequestRef = useRef(0);
  const snapshotRequestRef = useRef(0);
  const snapshotLoadingRef = useRef(false);
  const vehicleSnapshotRef = useRef<VehicleSnapshot | null>(demoVehicleSnapshot);
  const locationRequestRef = useRef(0);
  const statisticsRequestRef = useRef(0);
  const comparisonRequestRef = useRef(0);
  const rideSpeedVerificationRequestRef = useRef(0);
  const viewRef = useRef<AppView>(view);
  const vehicleRef = useRef(vehicle);
  const statisticsYearRef = useRef(statisticsYear);
  const historyStartTimeRef = useRef<number | null>(demoHistoryStartTime);
  const rideDetailDeferredRef = useRef(false);
  const historyStartMonth = useMemo(
    () => (historyStartTime === null ? null : getMonthFromUnixSeconds(historyStartTime)),
    [historyStartTime],
  );

  const resetComparison = useCallback(() => {
    ++comparisonRequestRef.current;
    setComparisonDetail(null);
    setComparisonRideId(null);
    setComparisonLoading(false);
    setComparisonError(null);
  }, []);

  const resetRideSpeedVerification = useCallback((initialDetail: RideDetail | null = null) => {
    ++rideSpeedVerificationRequestRef.current;
    setRideSpeedVerifications(
      initialDetail ? { [initialDetail.id]: createRideSpeedVerification(initialDetail) } : {},
    );
    setRideSpeedVerificationState({ status: "idle" });
  }, []);

  const rememberRideSpeedVerification = useCallback((nextDetail: RideDetail) => {
    setRideSpeedVerifications((current) => ({
      ...current,
      [nextDetail.id]: createRideSpeedVerification(nextDetail),
    }));
  }, []);

  const seekPlayback = useCallback((position: number) => {
    playbackPositionRef.current = position;
    setPlaybackPosition(position);
  }, []);

  const loadVehicleSnapshot = useCallback(
    async (
      targetVehicle: VehicleSummary,
      refresh = false,
      source: VehicleSnapshotRefreshSource = "initial",
    ) => {
      if (!window.ninebot) return;
      if (source === "automatic" && snapshotLoadingRef.current) return;
      const requestId = ++snapshotRequestRef.current;
      snapshotLoadingRef.current = true;
      setSnapshotLoading(true);
      setSnapshotError(null);
      try {
        const nextSnapshot = unwrap(
          await window.ninebot.vehicles.snapshot({ vehicleId: targetVehicle.id, refresh }),
        );
        if (requestId !== snapshotRequestRef.current) return;
        const observedAt = Date.now();
        const previousSnapshot = vehicleSnapshotRef.current;
        vehicleSnapshotRef.current = nextSnapshot;
        setVehicleSnapshot(nextSnapshot);
        setSnapshotUpdatedAt(observedAt);
        if (source !== "initial") {
          dispatchSnapshotMonitor({
            type: "record",
            event: {
              observedAt,
              source,
              hasComparison: previousSnapshot !== null,
              changes: previousSnapshot
                ? createVehicleSnapshotChanges(previousSnapshot, nextSnapshot)
                : [],
            },
          });
        }
      } catch (cause) {
        if (requestId === snapshotRequestRef.current) {
          setSnapshotError(cause instanceof Error ? cause.message : "无法读取车辆实时状态。");
        }
      } finally {
        if (requestId === snapshotRequestRef.current) {
          snapshotLoadingRef.current = false;
          setSnapshotLoading(false);
        }
      }
    },
    [],
  );

  const loadVehicleLocation = useCallback(async (targetVehicle: VehicleSummary) => {
    const bridge = window.ninebot;
    if (!bridge) return;
    const requestId = ++locationRequestRef.current;
    setLocationLoading(true);
    setLocationError(null);
    setLocationPermission("unknown");
    try {
      const nextRead = unwrap(await bridge.vehicles.location({ vehicleId: targetVehicle.id }));
      if (requestId !== locationRequestRef.current) return;
      setVehicleLocation(nextRead.location);
      setLocationPermission(nextRead.permission);
      setLocationUpdatedAt(Date.now());
      if (nextRead.permission !== "denied" && !nextRead.location) {
        setLocationError("九号服务没有返回有效车辆位置。");
      }
    } catch (cause) {
      if (requestId === locationRequestRef.current) {
        setLocationError(cause instanceof Error ? cause.message : "无法读取车辆位置。");
      }
    } finally {
      if (requestId === locationRequestRef.current) setLocationLoading(false);
    }
  }, []);

  const loadYearStatistics = useCallback(
    async (targetYear: number, targetVehicle: VehicleSummary, refresh = false) => {
      const bridge = window.ninebot;
      if (!bridge) return;
      const requestId = ++statisticsRequestRef.current;
      const yearMonthKeys = createStatisticsMonthKeys(
        targetYear,
        thisMonth,
        historyStartTimeRef.current,
      );
      const rollingMonthKeys =
        targetYear === currentYear ? createRollingStatisticsMonthKeys(thisMonth) : [];
      const historyStartMonthKey =
        historyStartTimeRef.current === null
          ? null
          : getMonthFromUnixSeconds(historyStartTimeRef.current);
      const requestMonthKeys = [
        ...new Set([
          ...yearMonthKeys,
          ...rollingMonthKeys.filter(
            (monthKey) => historyStartMonthKey === null || monthKey >= historyStartMonthKey,
          ),
        ]),
      ].toSorted();
      const yearMonthKeySet = new Set(yearMonthKeys);
      const monthSummaries = new Map<string, RideMonthSummary>();
      const sourceMonths = new Map<string, YearSummaryExportMonth>();
      setStatistics(null);
      setRollingStatisticsMonths([]);
      setStatisticsSourceMonths([]);
      setStatisticsLoading(true);
      setStatisticsError(null);
      setYearExportOpen(false);
      setYearExportError(null);
      setYearExportNotice(null);
      setStatisticsProgress({ loaded: 0, total: requestMonthKeys.length });
      try {
        for (let index = 0; index < requestMonthKeys.length; index += STATISTICS_BATCH_SIZE) {
          const batch = requestMonthKeys.slice(index, index + STATISTICS_BATCH_SIZE);
          // Keep at most three ninecli processes active to avoid hammering the private upstream API.
          // oxlint-disable-next-line no-await-in-loop
          const results = await Promise.all(
            batch.map(async (monthKey) => ({
              month: monthKey,
              rideMonth: unwrap(
                await bridge.rides.list({
                  vehicleId: targetVehicle.id,
                  month: monthKey,
                  refresh,
                }),
              ),
            })),
          );
          if (requestId !== statisticsRequestRef.current) return;
          for (const { month: monthKey, rideMonth } of results) {
            monthSummaries.set(monthKey, rideMonth.summary);
            if (yearMonthKeySet.has(monthKey)) {
              sourceMonths.set(monthKey, { summary: rideMonth.summary, days: rideMonth.days });
            }
          }
          setStatisticsProgress({
            loaded: Math.min(index + batch.length, requestMonthKeys.length),
            total: requestMonthKeys.length,
          });
        }
        if (requestId !== statisticsRequestRef.current) return;
        setStatistics(summarizeYearRides(targetYear, monthSummaries));
        setRollingStatisticsMonths(
          targetYear === currentYear ? summarizeRideRange(rollingMonthKeys, monthSummaries) : [],
        );
        setStatisticsSourceMonths(
          [...sourceMonths.values()].toSorted((left, right) =>
            left.summary.month.localeCompare(right.summary.month),
          ),
        );
      } catch (cause) {
        if (requestId === statisticsRequestRef.current) {
          setStatisticsError(cause instanceof Error ? cause.message : "无法读取年度骑行统计。");
        }
      } finally {
        if (requestId === statisticsRequestRef.current) setStatisticsLoading(false);
      }
    },
    [currentYear, thisMonth],
  );

  const loadLiveData = useCallback(
    async (
      targetMonth: string,
      knownVehicle?: VehicleSummary,
      { refresh = false, loadFirstRideDetail }: LiveDataOptions = {},
    ) => {
      if (!window.ninebot) return;
      setDetailRefreshState({ status: "idle" });
      if (loadFirstRideDetail !== undefined) {
        rideDetailDeferredRef.current = !loadFirstRideDetail;
      }
      const shouldLoadFirstRideDetail = !rideDetailDeferredRef.current;
      const requestId = ++liveRequestRef.current;
      setLoading(true);
      setError(null);
      setIsPlaying(false);
      resetComparison();
      resetRideSpeedVerification();
      if (viewRef.current === "comparison") {
        viewRef.current = "rides";
        setView("rides");
      }
      try {
        const nextVehicles = knownVehicle ? null : unwrap(await window.ninebot.vehicles.list());
        const nextVehicle = knownVehicle ?? nextVehicles?.[0];
        if (!nextVehicle) throw new Error("当前账号没有可读取的车辆。");
        if (requestId !== liveRequestRef.current) return;
        if (nextVehicles) setVehicles(nextVehicles);
        vehicleRef.current = nextVehicle;
        setVehicle(nextVehicle);
        setVehiclePickerOpen(false);
        setMode("live");
        if (!knownVehicle) {
          historyStartTimeRef.current = null;
          setHistoryStartTime(null);
          vehicleSnapshotRef.current = null;
          setVehicleSnapshot(null);
          setSnapshotUpdatedAt(null);
          dispatchSnapshotMonitor({ type: "clear-event" });
          ++locationRequestRef.current;
          setVehicleLocation(null);
          setLocationPermission("unknown");
          setLocationAuthorized(false);
          setLocationLoading(false);
          setLocationError(null);
          setLocationUpdatedAt(null);
        }
        if (viewRef.current === "device") void loadVehicleSnapshot(nextVehicle);
        setRides([]);
        setRideDays([]);
        setSelectedRideDay(null);
        setRideMonthSummary(createDemoMonthSummary(targetMonth, []));
        setDetail(null);
        setSelectedRideId(null);
        seekPlayback(0);
        const nextRideMonth = unwrap(
          await window.ninebot.rides.list({
            vehicleId: nextVehicle.id,
            month: targetMonth,
            refresh,
          }),
        );
        if (requestId !== liveRequestRef.current) return;
        const nextRides = nextRideMonth.rides;
        const firstRide = nextRides[0];
        setRides(nextRides);
        setRideDays(nextRideMonth.days);
        setRideMonthSummary(nextRideMonth.summary);
        if (nextRideMonth.summary.historyStartTime !== null) {
          historyStartTimeRef.current = nextRideMonth.summary.historyStartTime;
          setHistoryStartTime(nextRideMonth.summary.historyStartTime);
        }
        if (viewRef.current === "statistics") {
          void loadYearStatistics(statisticsYearRef.current, nextVehicle);
        }
        if (!firstRide || !shouldLoadFirstRideDetail) return nextVehicle;
        const nextDetail = unwrap(
          await window.ninebot.rides.detail({ vehicleId: nextVehicle.id, rideId: firstRide.id }),
        );
        if (requestId !== liveRequestRef.current) return;
        rideDetailDeferredRef.current = false;
        setDetail(nextDetail);
        rememberRideSpeedVerification(nextDetail);
        setSelectedRideId(nextDetail.id);
        seekPlayback(Math.min(38, Math.max(0, nextDetail.track.length - 1)));
        return nextVehicle;
      } catch (cause) {
        if (requestId === liveRequestRef.current) {
          setError(cause instanceof Error ? cause.message : "读取九号数据失败。");
        }
      } finally {
        if (requestId === liveRequestRef.current) setLoading(false);
      }
    },
    [
      loadVehicleSnapshot,
      loadYearStatistics,
      rememberRideSpeedVerification,
      resetComparison,
      resetRideSpeedVerification,
      seekPlayback,
    ],
  );

  useEffect(() => {
    if (!window.ninebot) return;
    void window.ninebot.auth.status().then((result) => {
      if (result.ok && result.data.connected) void loadLiveData(thisMonth);
    });
  }, [loadLiveData, thisMonth]);

  useEffect(() => {
    if (!snapshotAutoRefreshEnabled || mode !== "live" || view !== "device") return;
    const interval = window.setInterval(() => {
      if (
        !shouldRunVehicleMonitor({
          enabled: snapshotAutoRefreshEnabled,
          live: mode === "live",
          deviceViewVisible: viewRef.current === "device",
          documentVisible: document.visibilityState === "visible",
          loading: snapshotLoadingRef.current,
        })
      ) {
        return;
      }
      void loadVehicleSnapshot(vehicleRef.current, true, "automatic");
    }, VEHICLE_MONITOR_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [loadVehicleSnapshot, mode, snapshotAutoRefreshEnabled, view]);

  useEffect(() => {
    if (!isPlaying || !detail || detail.track.length <= 1) return;
    let animationFrame = 0;
    const maximumPosition = detail.track.length - 1;
    const tick = (timestamp: number) => {
      const previousTimestamp = lastFrame.current;
      lastFrame.current = timestamp;
      if (previousTimestamp !== null) {
        const elapsedMilliseconds = Math.min(
          MAX_FRAME_DELTA_MS,
          Math.max(0, timestamp - previousTimestamp),
        );
        const nextPosition = advancePlaybackPosition(
          playbackPositionRef.current,
          elapsedMilliseconds,
          playbackRate,
          PLAYBACK_SEGMENT_DURATION_MS,
        );
        if (nextPosition >= maximumPosition) {
          seekPlayback(maximumPosition);
          setIsPlaying(false);
          return;
        }
        seekPlayback(nextPosition);
      }
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(animationFrame);
      lastFrame.current = null;
    };
  }, [detail, isPlaying, playbackRate, seekPlayback]);

  const selectRide = async (
    ride: RideSummary,
    { refresh = false, preservePlayback = false }: RideSelectionOptions = {},
  ) => {
    rideDetailDeferredRef.current = false;
    const previousTrackLength = detail?.track.length ?? 0;
    const previousPlaybackPosition = playbackPositionRef.current;
    setExportOpen(false);
    setExportError(null);
    setExportNotice(null);
    setSelectedRideId(ride.id);
    setIsPlaying(false);
    if (!preservePlayback) seekPlayback(0);
    setDetailRefreshState(refresh ? { status: "loading" } : { status: "idle" });
    if (mode === "demo" || !window.ninebot) {
      setDetail(createDemoDetail(ride));
      setDetailRefreshState({ status: "idle" });
      return;
    }
    const requestId = ++liveRequestRef.current;
    if (!refresh) setLoading(true);
    setError(null);
    try {
      const nextDetail = unwrap(
        await window.ninebot.rides.detail({ vehicleId: vehicle.id, rideId: ride.id, refresh }),
      );
      if (requestId === liveRequestRef.current) {
        setDetail(nextDetail);
        rememberRideSpeedVerification(nextDetail);
        if (preservePlayback) {
          seekPlayback(
            remapTrackPosition(
              previousPlaybackPosition,
              previousTrackLength,
              nextDetail.track.length,
            ),
          );
        }
        if (refresh) setDetailRefreshState({ status: "success" });
      }
    } catch (cause) {
      if (requestId === liveRequestRef.current) {
        const message = cause instanceof Error ? cause.message : "无法读取这次行程。";
        if (refresh) setDetailRefreshState({ status: "error", message });
        else setError(message);
      }
    } finally {
      if (requestId === liveRequestRef.current && !refresh) setLoading(false);
    }
  };

  const selectRideDay = (day: number | null) => {
    setSelectedRideDay(day);
    if (day === null) {
      if (!detail && rides[0]) void selectRide(rides[0]);
      return;
    }
    const firstRide = rides.find(({ startTime }) => new Date(startTime * 1000).getDate() === day);
    if (firstRide) {
      void selectRide(firstRide);
      return;
    }
    ++liveRequestRef.current;
    setLoading(false);
    setIsPlaying(false);
    setDetail(null);
    setSelectedRideId(null);
    setDetailRefreshState({ status: "idle" });
    seekPlayback(0);
  };

  const verifyMonthRideSpeeds = async () => {
    if (rides.length === 0 || rideSpeedVerificationState.status === "loading") return;
    const requestId = ++rideSpeedVerificationRequestRef.current;
    setRideSpeedVerificationState({ status: "loading" });
    try {
      const result =
        mode === "demo" || !window.ninebot
          ? {
              rides: rides.map((ride) => createRideSpeedVerification(createDemoDetail(ride))),
              failedRideCount: 0,
            }
          : unwrap(
              await window.ninebot.rides.verifySpeeds({
                vehicleId: vehicle.id,
                rideIds: rides.map(({ id }) => id),
              }),
            );
      if (requestId !== rideSpeedVerificationRequestRef.current) return;
      setRideSpeedVerifications(
        Object.fromEntries(result.rides.map((verification) => [verification.id, verification])),
      );
      setRideSpeedVerificationState({
        status: "success",
        failedRideCount: result.failedRideCount,
      });
    } catch (cause) {
      if (requestId === rideSpeedVerificationRequestRef.current) {
        setRideSpeedVerificationState({
          status: "error",
          message: cause instanceof Error ? cause.message : "无法校验本月极速。",
        });
      }
    }
  };

  const loadComparisonRide = async (ride: RideSummary) => {
    const requestId = ++comparisonRequestRef.current;
    setComparisonRideId(ride.id);
    setComparisonDetail(null);
    setComparisonLoading(true);
    setComparisonError(null);
    if (mode === "demo" || !window.ninebot) {
      setComparisonDetail(createDemoDetail(ride));
      setComparisonLoading(false);
      return;
    }
    try {
      const nextDetail = unwrap(
        await window.ninebot.rides.detail({ vehicleId: vehicle.id, rideId: ride.id }),
      );
      if (requestId === comparisonRequestRef.current) {
        setComparisonDetail(nextDetail);
        rememberRideSpeedVerification(nextDetail);
      }
    } catch (cause) {
      if (requestId === comparisonRequestRef.current) {
        setComparisonError(cause instanceof Error ? cause.message : "无法读取对比行程。");
      }
    } finally {
      if (requestId === comparisonRequestRef.current) setComparisonLoading(false);
    }
  };

  const openComparison = () => {
    if (!detail) return;
    const candidate = rides.find(({ id }) => id !== detail.id);
    if (!candidate) return;
    viewRef.current = "comparison";
    setView("comparison");
    setMonthPickerOpen(false);
    setVehiclePickerOpen(false);
    setIsPlaying(false);
    void loadComparisonRide(candidate);
  };

  const closeComparison = () => {
    resetComparison();
    viewRef.current = "rides";
    setView("rides");
  };

  const login = async (input: PasswordLoginInput) => {
    if (!window.ninebot) return;
    setLoginBusy(true);
    setError(null);
    try {
      unwrap(await window.ninebot.auth.passwordLogin(input));
      setSecurityStatus(null);
      setAccountProfile(null);
      setAccountProfileError(null);
      setLoginOpen(false);
      await loadLiveData(month);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "连接账号失败。");
    } finally {
      setLoginBusy(false);
    }
  };

  const requestSmsCode = async (input: SmsCodeRequestInput) => {
    if (!window.ninebot) return false;
    setLoginBusy(true);
    setError(null);
    try {
      unwrap(await window.ninebot.auth.requestSmsCode(input));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法发送短信验证码。");
      return false;
    } finally {
      setLoginBusy(false);
    }
  };

  const loginWithSmsCode = async (input: SmsCodeLoginInput) => {
    if (!window.ninebot) return;
    setLoginBusy(true);
    setError(null);
    try {
      unwrap(await window.ninebot.auth.smsCodeLogin(input));
      setSecurityStatus(null);
      setAccountProfile(null);
      setAccountProfileError(null);
      setLoginOpen(false);
      await loadLiveData(month);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "验证码登录失败。");
    } finally {
      setLoginBusy(false);
    }
  };

  const exportRide = async (format: RideExportFormat) => {
    if (!window.ninebot || !detail) return;
    setExportBusy(true);
    setExportFormat(format);
    setExportError(null);
    try {
      const result = unwrap(
        await window.ninebot.rides.export({ vehicleName: vehicle.name, detail, format }),
      );
      if (!result.saved || !result.fileName) return;
      setExportNotice(`已导出 ${result.fileName}`);
      setExportOpen(false);
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "无法导出当前行程。");
    } finally {
      setExportBusy(false);
      setExportFormat(null);
    }
  };

  const exportYearSummary = async (format: YearSummaryExportFormat) => {
    if (!window.ninebot || statisticsSourceMonths.length === 0) return;
    setYearExportBusy(true);
    setYearExportFormat(format);
    setYearExportError(null);
    try {
      const result = unwrap(
        await window.ninebot.rides.exportYearSummary({
          vehicleName: vehicle.name,
          year: statisticsYear,
          historyStartTime,
          months: statisticsSourceMonths,
          format,
        }),
      );
      if (!result.saved || !result.fileName) return;
      setYearExportNotice(`已导出 ${result.fileName}`);
      setYearExportOpen(false);
    } catch (cause) {
      setYearExportError(cause instanceof Error ? cause.message : "无法导出年度摘要。");
    } finally {
      setYearExportBusy(false);
      setYearExportFormat(null);
    }
  };

  const exportMonthSummary = async (format: MonthSummaryExportFormat) => {
    if (!window.ninebot) return;
    setMonthExportBusy(true);
    setMonthExportFormat(format);
    setMonthExportError(null);
    try {
      const currentRideIds = new Set(rides.map(({ id }) => id));
      const speedVerifications = Object.values(rideSpeedVerifications).filter(({ id }) =>
        currentRideIds.has(id),
      );
      const result = unwrap(
        await window.ninebot.rides.exportMonthSummary({
          vehicleName: vehicle.name,
          month: { summary: rideMonthSummary, days: rideDays, rides },
          speedVerifications,
          format,
        }),
      );
      if (!result.saved || !result.fileName) return;
      setMonthExportNotice(`已导出 ${result.fileName}`);
      setMonthExportOpen(false);
    } catch (cause) {
      setMonthExportError(cause instanceof Error ? cause.message : "无法导出月度行程清单。");
    } finally {
      setMonthExportBusy(false);
      setMonthExportFormat(null);
    }
  };

  const loadSecurityStatus = useCallback(async () => {
    if (!window.ninebot) return;
    setSecurityBusy(true);
    setSecurityError(null);
    setAccountProfileError(null);
    try {
      const [securityResult, profileResult] = await Promise.all([
        window.ninebot.runtime.security(),
        window.ninebot.auth.profile(),
      ]);
      setSecurityStatus(unwrap(securityResult));
      if (profileResult.ok) {
        setAccountProfile(profileResult.data);
      } else {
        setAccountProfile(null);
        if (profileResult.error.code !== "AUTH_REQUIRED") {
          setAccountProfileError(profileResult.error.message);
        }
      }
    } catch (cause) {
      setSecurityError(cause instanceof Error ? cause.message : "无法读取运行时安全状态。");
    } finally {
      setSecurityBusy(false);
    }
  }, []);

  const openSecurity = () => {
    setSecurityOpen(true);
    void loadSecurityStatus();
  };

  const logout = async () => {
    if (!window.ninebot) return;
    ++liveRequestRef.current;
    ++snapshotRequestRef.current;
    ++locationRequestRef.current;
    ++statisticsRequestRef.current;
    resetComparison();
    resetRideSpeedVerification(demoDetail);
    setSecurityBusy(true);
    setSecurityError(null);
    try {
      unwrap(await window.ninebot.auth.logout());
      setAccountProfile(null);
      setAccountProfileError(null);
      setMode("demo");
      historyStartTimeRef.current = demoHistoryStartTime;
      setHistoryStartTime(demoHistoryStartTime);
      setVehicles(demoVehicles);
      setMonth(thisMonth);
      setMonthPickerYear(getMonthYear(thisMonth));
      setMonthPickerOpen(false);
      setVehicle(demoVehicle);
      vehicleRef.current = demoVehicle;
      setVehiclePickerOpen(false);
      vehicleSnapshotRef.current = demoVehicleSnapshot;
      setVehicleSnapshot(demoVehicleSnapshot);
      setSnapshotUpdatedAt(null);
      setSnapshotError(null);
      snapshotLoadingRef.current = false;
      dispatchSnapshotMonitor({ type: "reset" });
      setVehicleLocation(null);
      setLocationPermission("unknown");
      setLocationAuthorized(false);
      setLocationLoading(false);
      setLocationError(null);
      setLocationUpdatedAt(null);
      setStatisticsYear(currentYear);
      statisticsYearRef.current = currentYear;
      setStatistics(createDemoYearStatistics(currentYear, thisMonth));
      setRollingStatisticsMonths(createDemoRollingStatistics(thisMonth));
      setStatisticsSourceMonths(createDemoYearMonths(currentYear, thisMonth));
      setStatisticsLoading(false);
      setStatisticsProgress({ loaded: 0, total: 0 });
      setStatisticsError(null);
      setYearExportOpen(false);
      setYearExportError(null);
      setYearExportNotice(null);
      setExportOpen(false);
      setExportError(null);
      setExportNotice(null);
      setMonthExportOpen(false);
      setMonthExportError(null);
      setMonthExportNotice(null);
      setRides(demoRides);
      setRideDays(createDemoRideDays(thisMonth, demoRides));
      setSelectedRideDay(null);
      setRideMonthSummary(createDemoMonthSummary(thisMonth, demoRides));
      setDetail(demoDetail);
      setSelectedRideId(demoDetail.id);
      setDetailRefreshState({ status: "idle" });
      if (viewRef.current === "comparison") {
        viewRef.current = "rides";
        setView("rides");
      }
      setIsPlaying(false);
      seekPlayback(38);
      setSecurityStatus(unwrap(await window.ninebot.runtime.security()));
    } catch (cause) {
      setSecurityError(cause instanceof Error ? cause.message : "无法清除本地登录令牌。");
    } finally {
      setSecurityBusy(false);
    }
  };

  const selectMonth = (nextMonth: string, options: LiveDataOptions = {}) => {
    if (historyStartMonth !== null && nextMonth < historyStartMonth) return;
    rideDetailDeferredRef.current = options.loadFirstRideDetail === false;
    setDetailRefreshState({ status: "idle" });
    setExportOpen(false);
    setExportError(null);
    setExportNotice(null);
    setMonthExportOpen(false);
    setMonthExportError(null);
    setMonthExportNotice(null);
    resetComparison();
    resetRideSpeedVerification();
    setMonth(nextMonth);
    setMonthPickerYear(getMonthYear(nextMonth));
    setMonthPickerOpen(false);
    setError(null);
    setIsPlaying(false);
    setSelectedRideDay(null);

    if (mode === "live") {
      void loadLiveData(nextMonth, vehicle, options);
      return;
    }

    if (nextMonth === thisMonth) {
      setRides(demoRides);
      setRideDays(createDemoRideDays(thisMonth, demoRides));
      setRideMonthSummary(createDemoMonthSummary(thisMonth, demoRides));
      if (options.loadFirstRideDetail === false) {
        setDetail(null);
        setSelectedRideId(null);
        seekPlayback(0);
      } else {
        setDetail(demoDetail);
        rememberRideSpeedVerification(demoDetail);
        setSelectedRideId(demoDetail.id);
        seekPlayback(38);
      }
      return;
    }

    setRides([]);
    setRideDays(createDemoRideDays(nextMonth, []));
    setRideMonthSummary(createDemoMonthSummary(nextMonth, []));
    setDetail(null);
    setSelectedRideId(null);
    seekPlayback(0);
  };

  const selectVehicle = (nextVehicle: VehicleSummary) => {
    setVehiclePickerOpen(false);
    if (nextVehicle.id === vehicleRef.current.id) return;
    rideDetailDeferredRef.current = false;
    setDetailRefreshState({ status: "idle" });

    setExportOpen(false);
    setExportError(null);
    setExportNotice(null);
    setMonthExportOpen(false);
    setMonthExportError(null);
    setMonthExportNotice(null);
    resetComparison();
    resetRideSpeedVerification();
    if (viewRef.current === "comparison") {
      viewRef.current = "rides";
      setView("rides");
    }

    ++snapshotRequestRef.current;
    ++locationRequestRef.current;
    ++statisticsRequestRef.current;
    dispatchSnapshotMonitor({ type: "reset" });
    setRollingStatisticsMonths([]);
    setStatisticsSourceMonths([]);
    setYearExportOpen(false);
    setYearExportError(null);
    setYearExportNotice(null);
    historyStartTimeRef.current = mode === "live" ? null : demoHistoryStartTime;
    setHistoryStartTime(mode === "live" ? null : demoHistoryStartTime);
    vehicleRef.current = nextVehicle;
    setVehicle(nextVehicle);
    setSnapshotLoading(false);
    setSnapshotError(null);
    setSnapshotUpdatedAt(null);
    snapshotLoadingRef.current = false;
    setVehicleLocation(null);
    setLocationPermission("unknown");
    setLocationAuthorized(false);
    setLocationLoading(false);
    setLocationError(null);
    setLocationUpdatedAt(null);
    setIsPlaying(false);
    setSelectedRideDay(null);
    seekPlayback(0);

    if (mode === "live") {
      vehicleSnapshotRef.current = null;
      setVehicleSnapshot(null);
      void loadLiveData(month, nextVehicle);
      return;
    }

    const demoSnapshot = demoVehicleSnapshots[nextVehicle.id] ?? demoVehicleSnapshot;
    vehicleSnapshotRef.current = demoSnapshot;
    setVehicleSnapshot(demoSnapshot);
    setRides(demoRides);
    setRideDays(createDemoRideDays(month, demoRides));
    setRideMonthSummary(createDemoMonthSummary(month, demoRides));
    setDetail(demoDetail);
    rememberRideSpeedVerification(demoDetail);
    setSelectedRideId(demoDetail.id);
    setStatistics(createDemoYearStatistics(statisticsYear, thisMonth));
    setRollingStatisticsMonths(
      statisticsYear === currentYear ? createDemoRollingStatistics(thisMonth) : [],
    );
    setStatisticsSourceMonths(createDemoYearMonths(statisticsYear, thisMonth));
    seekPlayback(38);
  };

  const selectStatisticsYear = (nextYear: number) => {
    const minimumYear = historyStartMonth === null ? null : getMonthYear(historyStartMonth);
    if (nextYear > currentYear || (minimumYear !== null && nextYear < minimumYear)) return;
    statisticsYearRef.current = nextYear;
    setStatisticsYear(nextYear);
    setYearExportOpen(false);
    setYearExportError(null);
    setYearExportNotice(null);
    if (mode === "live") {
      void loadYearStatistics(nextYear, vehicle);
      return;
    }
    setStatistics(createDemoYearStatistics(nextYear, thisMonth));
    setRollingStatisticsMonths(
      nextYear === currentYear ? createDemoRollingStatistics(thisMonth) : [],
    );
    setStatisticsSourceMonths(createDemoYearMonths(nextYear, thisMonth));
  };

  const showDevice = () => {
    resetComparison();
    viewRef.current = "device";
    setView("device");
    setMonthPickerOpen(false);
    setVehiclePickerOpen(false);
    setIsPlaying(false);
    if (mode === "live") {
      void loadVehicleSnapshot(
        vehicle,
        snapshotAutoRefreshEnabled,
        snapshotAutoRefreshEnabled ? "automatic" : "initial",
      );
    }
  };

  const toggleSnapshotAutoRefresh = () => {
    if (mode !== "live" || snapshotLoading) return;
    const enabled = !snapshotAutoRefreshEnabled;
    if (enabled && viewRef.current === "device") {
      dispatchSnapshotMonitor({ type: "enable" });
      void loadVehicleSnapshot(vehicle, true, "automatic");
      return;
    }
    dispatchSnapshotMonitor({ type: "disable" });
  };

  const showRides = () => {
    resetComparison();
    viewRef.current = "rides";
    setView("rides");
    setVehiclePickerOpen(false);
  };

  const showMap = () => {
    resetComparison();
    viewRef.current = "map";
    setView("map");
    setMonthPickerOpen(false);
    setVehiclePickerOpen(false);
    setIsPlaying(false);
  };

  const authorizeLocation = () => {
    setLocationAuthorized(true);
    if (mode === "live") {
      void loadVehicleLocation(vehicle);
      return;
    }
    const demoPermission = demoVehicleLocationPermissions[vehicle.id] ?? "unknown";
    const demoLocation =
      demoPermission === "allowed" ? (demoVehicleLocations[vehicle.id] ?? null) : null;
    setVehicleLocation(demoLocation);
    setLocationPermission(demoPermission);
    setLocationUpdatedAt(Date.now());
    setLocationError(demoPermission === "denied" || demoLocation ? null : "没有可用的演示位置。");
  };

  const clearLocation = () => {
    ++locationRequestRef.current;
    setLocationAuthorized(false);
    setVehicleLocation(null);
    setLocationPermission("unknown");
    setLocationLoading(false);
    setLocationError(null);
    setLocationUpdatedAt(null);
  };

  const showStatistics = () => {
    resetComparison();
    viewRef.current = "statistics";
    setView("statistics");
    setMonthPickerOpen(false);
    setVehiclePickerOpen(false);
    setIsPlaying(false);
    if (mode === "live") void loadYearStatistics(statisticsYear, vehicle);
  };

  const openStatisticsMonth = (targetMonth: string) => {
    viewRef.current = "rides";
    setView("rides");
    selectMonth(targetMonth, { loadFirstRideDetail: false });
  };

  const track = detail?.track ?? EMPTY_TRACK;
  const currentRide = useMemo(
    () => rides.find(({ id }) => id === selectedRideId) ?? null,
    [rides, selectedRideId],
  );
  const comparisonCandidates = useMemo(
    () => (detail ? rides.filter(({ id }) => id !== detail.id) : []),
    [detail, rides],
  );
  const displayedRides = useMemo(
    () =>
      selectedRideDay === null
        ? rides
        : rides.filter(({ startTime }) => new Date(startTime * 1000).getDate() === selectedRideDay),
    [rides, selectedRideDay],
  );
  const activePoint = interpolateTrackPoint(track, playbackPosition);
  const elapsedSeconds = activePoint?.offsetSeconds ?? 0;
  const progress = track.length <= 1 ? 0 : (playbackPosition / (track.length - 1)) * 100;
  const maxSpeed = detail
    ? resolveDisplayedMaxSpeed(detail.sampledMaxSpeed, detail.declaredMaxSpeed)
    : 0;
  const rideEnergyEfficiency = detail
    ? calculateRideEnergyEfficiency(detail.energyWh, detail.mileageKm)
    : null;
  const rideDayShare = detail ? calculateRideDayShare(detail.mileageKm, detail.dayMileageKm) : null;
  const declaredMaxSpeedLikelyCapped = detail
    ? isLikelyCappedMaxSpeedDeclaration(detail.sampledMaxSpeed, detail.declaredMaxSpeed)
    : false;
  const detailRefreshing = detailRefreshState.status === "loading";
  const speedVerificationLoading = rideSpeedVerificationState.status === "loading";
  const verifiedSpeedCount = rides.filter(({ id }) => rideSpeedVerifications[id]).length;
  const correctedSpeedCount = rides.filter(({ id }) => {
    const verification = rideSpeedVerifications[id];
    return (
      verification !== undefined &&
      isLikelyCappedMaxSpeedDeclaration(verification.sampledMaxSpeed, verification.declaredMaxSpeed)
    );
  }).length;
  const unresolvedSpeedPlaceholderCount = rides.filter((ride) => {
    const verification = rideSpeedVerifications[ride.id];
    const sampledMaxSpeed = verification?.sampledMaxSpeed ?? null;
    const declaredMaxSpeed = verification?.declaredMaxSpeed ?? ride.declaredMaxSpeed;
    return sampledMaxSpeed === null && declaredMaxSpeed === 25;
  }).length;
  const failedSpeedVerificationCount =
    rideSpeedVerificationState.status === "success"
      ? rideSpeedVerificationState.failedRideCount
      : 0;

  const refreshCurrentRide = () => {
    if (mode !== "live" || !currentRide || detailRefreshing) return;
    void selectRide(currentRide, { refresh: true, preservePlayback: true });
  };

  const togglePlayback = () => {
    if (track.length <= 1) return;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    const maximumPosition = Math.max(0, track.length - 1);
    if (playbackPositionRef.current >= maximumPosition) seekPlayback(0);
    setIsPlaying(true);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-scroll">
          <div className="brand-row">
            <div className="brand-mark">
              <Route size={21} strokeWidth={2.5} />
            </div>
            <strong>骑迹</strong>
          </div>

          <section className="mt-8">
            <p className="sidebar-label">我的车辆</p>
            <VehicleSwitcher
              vehicles={vehicles}
              selectedVehicle={vehicle}
              live={mode === "live"}
              open={vehiclePickerOpen}
              disabled={loading || snapshotLoading || vehicles.length === 0}
              onToggle={() => setVehiclePickerOpen((open) => !open)}
              onSelect={selectVehicle}
            />
          </section>

          <nav className="mt-5 space-y-1" aria-label="主导航">
            <NavItem
              icon={<Bike size={18} />}
              label="设备"
              active={view === "device"}
              onClick={showDevice}
            />
            <NavItem
              icon={<MapIcon size={18} />}
              label="地图"
              active={view === "map"}
              onClick={showMap}
            />
            <NavItem
              icon={<Route size={18} />}
              label="轨迹"
              active={view === "rides" || view === "comparison"}
              onClick={showRides}
            />
            <NavItem
              icon={<ChartNoAxesCombined size={18} />}
              label="统计"
              active={view === "statistics"}
              onClick={showStatistics}
            />
            <NavItem icon={<Settings size={18} />} label="设置" onClick={openSecurity} />
          </nav>

          {view === "rides" ? (
            <div className="mt-7 flex items-start justify-between gap-2 px-2">
              <MonthNavigator
                month={month}
                visibleYear={monthPickerYear}
                open={monthPickerOpen}
                disabled={loading}
                minimumMonth={historyStartMonth}
                onToggle={() => {
                  setMonthPickerYear(getMonthYear(month));
                  setMonthPickerOpen((open) => !open);
                }}
                onVisibleYearChange={setMonthPickerYear}
                onSelect={selectMonth}
              />
              <div className="flex flex-none items-center gap-1.5">
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => {
                    setMonthExportError(null);
                    setMonthExportOpen(true);
                  }}
                  aria-label="导出本月清单"
                  disabled={loading}
                >
                  <Download size={16} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() =>
                    void (mode === "live"
                      ? loadLiveData(month, vehicle, { refresh: true })
                      : Promise.resolve())
                  }
                  aria-label="刷新行程"
                  disabled={loading || mode === "demo"}
                >
                  <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
                </button>
              </div>
            </div>
          ) : null}

          {view === "rides" ? (
            <div className="ride-month-summary" aria-label="月度行程汇总">
              <div>
                <strong>{rideMonthSummary.rideCount} 次</strong>
                <span>{rideMonthSummary.mileageKm.toFixed(1)} km</span>
                {rideMonthSummary.energyWh !== null ? (
                  <span>{(rideMonthSummary.energyWh / 1000).toFixed(2)} kWh</span>
                ) : null}
              </div>
              <small>
                {loading
                  ? "正在读取整月汇总…"
                  : rideMonthSummary.ridesTruncated
                    ? `可选择 ${rideMonthSummary.visibleRideCount} / ${rideMonthSummary.rideCount} 次行程`
                    : rideMonthSummary.aggregateAvailable
                      ? "整月汇总 · 明细完整"
                      : "按当前可见明细汇总"}
              </small>
              {monthExportNotice ? (
                <p className="month-export-notice" role="status">
                  {monthExportNotice}
                </p>
              ) : null}
            </div>
          ) : null}

          {view === "rides" ? (
            <RideSpeedVerificationPanel
              totalCount={rides.length}
              verifiedCount={verifiedSpeedCount}
              correctedCount={correctedSpeedCount}
              failedCount={failedSpeedVerificationCount}
              placeholderCount={unresolvedSpeedPlaceholderCount}
              loading={speedVerificationLoading}
              error={
                rideSpeedVerificationState.status === "error"
                  ? rideSpeedVerificationState.message
                  : null
              }
              disabled={loading || rides.length === 0}
              onVerify={() => void verifyMonthRideSpeeds()}
            />
          ) : null}

          {view === "rides" ? (
            <RideActivityCalendar
              month={month}
              days={rideDays}
              rides={rides}
              selectedDay={selectedRideDay}
              disabled={loading}
              onSelectDay={selectRideDay}
            />
          ) : null}

          {view === "rides" ? (
            <div className="mt-3 space-y-1.5" aria-label="骑行记录">
              {selectedRideDay !== null ? (
                <p className="ride-day-filter-note">
                  <span>{selectedRideDay} 日的可选行程</span>
                  <button type="button" onClick={() => selectRideDay(null)}>
                    显示全部
                  </button>
                </p>
              ) : null}
              {displayedRides.map((ride) => (
                <button
                  key={ride.id}
                  type="button"
                  onClick={() => void selectRide(ride)}
                  className={`ride-row ${selectedRideId === ride.id ? "ride-row-active" : ""}`}
                >
                  <span className="route-thumb" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <strong className="block text-[14px] font-[650] text-[#283645]">
                      {formatRideDate(ride.startTime)}
                    </strong>
                    <span className="mt-1 block truncate text-xs font-medium text-slate-500">
                      {ride.mileageKm.toFixed(1)} km · {formatDuration(ride.durationSeconds)}
                      {ride.energyWh !== null ? ` · ${ride.energyWh.toFixed(0)} Wh` : ""}
                    </span>
                  </span>
                  <RideSpeedReading
                    ride={ride}
                    verification={rideSpeedVerifications[ride.id] ?? null}
                  />
                </button>
              ))}
              {!loading && displayedRides.length === 0 ? (
                <p className="ride-list-empty">
                  {selectedRideDay !== null &&
                  (rideDays.find(({ day }) => day === selectedRideDay)?.mileageKm ?? 0) > 0
                    ? `${selectedRideDay} 日的里程已计入整月汇总，但不在九号返回的可选明细中`
                    : `${formatMonth(month)}暂无骑行记录`}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="border-t border-slate-200/80 p-4">
          <button
            className="secondary-button w-full"
            type="button"
            onClick={() => setLoginOpen(true)}
          >
            <CircleUserRound size={17} />
            {mode === "live" ? "重新连接账号" : "连接九号账号"}
          </button>
        </div>
      </aside>

      <main className="main-stage">
        <header className="titlebar">
          <span className="text-sm font-[660] text-[#25313d]">
            {view === "device"
              ? "车辆"
              : view === "map"
                ? "地图"
                : view === "statistics"
                  ? "统计"
                  : view === "comparison"
                    ? "行程对比"
                    : "骑迹"}
          </span>
          <div className="no-drag absolute right-5 flex items-center gap-2">
            {loading ||
            detailRefreshing ||
            speedVerificationLoading ||
            snapshotLoading ||
            locationLoading ||
            statisticsLoading ||
            comparisonLoading ? (
              <span className="status-chip">
                <LoaderCircle size={13} className="animate-spin" />
                正在同步
              </span>
            ) : null}
            {(
              view === "device"
                ? snapshotError
                : view === "map"
                  ? locationError
                  : view === "statistics"
                    ? statisticsError
                    : view === "comparison"
                      ? comparisonError
                      : error
            ) ? (
              <button
                className="error-chip"
                type="button"
                onClick={() => {
                  if (view === "device") setSnapshotError(null);
                  else if (view === "map") setLocationError(null);
                  else if (view === "statistics") setStatisticsError(null);
                  else if (view === "comparison") setComparisonError(null);
                  else setError(null);
                }}
              >
                {view === "device"
                  ? snapshotError
                  : view === "map"
                    ? locationError
                    : view === "statistics"
                      ? statisticsError
                      : view === "comparison"
                        ? comparisonError
                        : error}
              </button>
            ) : null}
          </div>
        </header>

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {view === "device" ? (
            <VehicleDashboard
              vehicle={vehicle}
              snapshot={vehicleSnapshot}
              live={mode === "live"}
              loading={snapshotLoading}
              error={snapshotError}
              updatedAt={snapshotUpdatedAt}
              autoRefreshEnabled={snapshotAutoRefreshEnabled}
              monitorEvent={snapshotMonitorEvent}
              onAutoRefreshChange={toggleSnapshotAutoRefresh}
              onRefresh={() => void loadVehicleSnapshot(vehicle, true, "manual")}
              onConnect={() => setLoginOpen(true)}
            />
          ) : view === "map" ? (
            <LocationDashboard
              vehicle={vehicle}
              location={vehicleLocation}
              permission={locationPermission}
              authorized={locationAuthorized}
              live={mode === "live"}
              loading={locationLoading}
              error={locationError}
              updatedAt={locationUpdatedAt}
              coordinateDisplayMode={coordinateDisplayMode}
              onAuthorize={authorizeLocation}
              onRefresh={() =>
                void (mode === "live" ? loadVehicleLocation(vehicle) : authorizeLocation())
              }
              onClear={clearLocation}
              onCoordinateDisplayModeChange={setCoordinateDisplayMode}
            />
          ) : view === "statistics" ? (
            <StatisticsDashboard
              vehicle={vehicle}
              statistics={statistics}
              rollingMonths={rollingStatisticsMonths}
              year={statisticsYear}
              currentMonth={thisMonth}
              historyStartTime={historyStartTime}
              live={mode === "live"}
              loading={statisticsLoading}
              progress={statisticsProgress}
              error={statisticsError}
              exportNotice={yearExportNotice}
              activityMonths={statisticsSourceMonths}
              onPreviousYear={() => selectStatisticsYear(statisticsYear - 1)}
              onNextYear={() => selectStatisticsYear(statisticsYear + 1)}
              onRefresh={() => void loadYearStatistics(statisticsYear, vehicle, true)}
              onExport={() => {
                setYearExportError(null);
                setYearExportOpen(true);
              }}
              exportDisabled={statisticsLoading || statisticsSourceMonths.length === 0}
              onSelectMonth={openStatisticsMonth}
              onConnect={() => setLoginOpen(true)}
            />
          ) : view === "comparison" && detail ? (
            <RideComparisonDashboard
              vehicle={vehicle}
              month={month}
              base={detail}
              comparison={comparisonDetail}
              candidates={comparisonCandidates}
              selectedRideId={comparisonRideId}
              loading={comparisonLoading}
              error={comparisonError}
              onBack={closeComparison}
              onSelect={(ride) => void loadComparisonRide(ride)}
              onRetry={() => {
                const selectedRide = comparisonCandidates.find(({ id }) => id === comparisonRideId);
                if (selectedRide) void loadComparisonRide(selectedRide);
              }}
            />
          ) : (
            <>
              <RouteMap
                track={track}
                playbackPosition={playbackPosition}
                coordinateDisplayMode={coordinateDisplayMode}
                onCoordinateDisplayModeChange={setCoordinateDisplayMode}
              />

              {detail ? (
                <>
                  <section className="metrics-panel" aria-label="本次骑行指标">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                          最高速度
                          <span className="metric-source-badge">
                            {detail.sampledMaxSpeed !== null ? "轨迹采样" : "接口摘要"}
                          </span>
                        </p>
                        <div className="mt-1 flex items-baseline gap-2">
                          <strong className="metric-number">{Math.round(maxSpeed)}</strong>
                          <span className="text-sm font-semibold text-slate-500">km/h</span>
                        </div>
                      </div>
                      <div className="ride-metric-actions">
                        <button
                          className="ride-export-trigger ride-detail-refresh-trigger"
                          type="button"
                          onClick={refreshCurrentRide}
                          disabled={
                            mode !== "live" || currentRide === null || detailRefreshing || loading
                          }
                          aria-label="刷新当前行程"
                          title={
                            mode === "live"
                              ? "绕过详情缓存，重新读取当前行程"
                              : "连接九号账号后可刷新真实行程"
                          }
                        >
                          {detailRefreshing ? (
                            <LoaderCircle size={15} className="animate-spin" />
                          ) : (
                            <RefreshCw size={15} />
                          )}
                        </button>
                        <button
                          className="ride-export-trigger"
                          type="button"
                          onClick={openComparison}
                          disabled={
                            comparisonCandidates.length === 0 || loading || detailRefreshing
                          }
                          aria-label="对比当前行程"
                        >
                          <GitCompareArrows size={15} />
                          对比
                        </button>
                        <button
                          className="ride-export-trigger"
                          type="button"
                          onClick={() => {
                            setExportError(null);
                            setExportOpen(true);
                          }}
                          disabled={detail.track.length === 0 || detailRefreshing}
                          aria-label="导出当前行程"
                        >
                          <Download size={15} />
                          导出
                        </button>
                      </div>
                    </div>
                    <div className="mt-5 grid grid-cols-3 gap-4 border-t border-slate-200/80 pt-4">
                      <Metric label="平均速度" value={detail.averageSpeed.toFixed(1)} unit="km/h" />
                      <Metric label="里程" value={detail.mileageKm.toFixed(1)} unit="km" />
                      <Metric label="用时" value={formatLongDuration(detail.durationSeconds)} />
                    </div>
                    {detail.energyWh !== null || detail.batteryUsedPercent !== null ? (
                      <div className="ride-energy-metrics" aria-label="本次骑行能耗">
                        <Metric
                          label="本次能耗"
                          value={detail.energyWh?.toFixed(0) ?? "—"}
                          unit={detail.energyWh !== null ? "Wh" : undefined}
                        />
                        <Metric
                          label="电量消耗"
                          value={detail.batteryUsedPercent?.toFixed(1) ?? "—"}
                          unit={detail.batteryUsedPercent !== null ? "%" : undefined}
                        />
                        <Metric
                          label="平均能耗"
                          value={rideEnergyEfficiency?.toFixed(1) ?? "—"}
                          unit={rideEnergyEfficiency !== null ? "Wh/km" : undefined}
                        />
                      </div>
                    ) : null}
                    {detail.dayMileageKm !== null ? (
                      <div className="ride-day-context" aria-label="骑行日背景">
                        <span>骑行日累计</span>
                        <strong>{detail.dayMileageKm.toFixed(1)} km</strong>
                        <small>
                          {rideDayShare === null
                            ? "本次占比不可用"
                            : `本次占当天 ${rideDayShare.toFixed(1)}%`}
                        </small>
                      </div>
                    ) : null}
                    <p
                      className={`ride-detail-refresh-state ${
                        detailRefreshState.status === "error"
                          ? "ride-detail-refresh-error"
                          : detailRefreshState.status === "loading" ||
                              detailRefreshState.status === "success"
                            ? "ride-detail-refresh-active"
                            : declaredMaxSpeedLikelyCapped
                              ? "ride-detail-source-warning"
                              : ""
                      }`}
                      role={detailRefreshState.status === "error" ? "alert" : "status"}
                      title={
                        detailRefreshState.status === "error"
                          ? detailRefreshState.message
                          : undefined
                      }
                    >
                      {detailRefreshState.status === "loading"
                        ? "正在绕过缓存重新读取当前行程…"
                        : detailRefreshState.status === "success"
                          ? "当前行程已重新读取"
                          : detailRefreshState.status === "error"
                            ? "刷新失败，旧数据已保留，请再次刷新"
                            : detail.sampledMaxSpeed !== null && detail.declaredMaxSpeed !== null
                              ? declaredMaxSpeedLikelyCapped
                                ? `旧记录摘要固定返回 25 km/h，已忽略；当前显示由 ${detail.track.length} 个轨迹点计算。`
                                : `接口摘要 ${detail.declaredMaxSpeed.toFixed(0)} km/h · 轨迹采样 ${detail.sampledMaxSpeed.toFixed(0)} km/h`
                              : "\u00a0"}
                    </p>
                    {exportNotice ? (
                      <p className="ride-export-notice" role="status">
                        {exportNotice}
                      </p>
                    ) : null}
                  </section>

                  <section
                    className={`playback-panel ${detailRefreshing ? "playback-panel-refreshing" : ""}`}
                    aria-label="轨迹回放控制"
                    aria-busy={detailRefreshing}
                    inert={detailRefreshing}
                  >
                    <div className="flex items-center gap-4 border-b border-slate-200/75 pb-4">
                      <button
                        className="play-button"
                        type="button"
                        onClick={togglePlayback}
                        disabled={track.length <= 1 || detailRefreshing}
                        aria-label={isPlaying ? "暂停回放" : "开始回放"}
                      >
                        {isPlaying ? (
                          <Pause size={19} fill="currentColor" />
                        ) : (
                          <Play size={19} fill="currentColor" />
                        )}
                      </button>
                      <span className="w-[94px] text-sm font-semibold tabular-nums text-slate-700">
                        {formatDuration(elapsedSeconds)}{" "}
                        <span className="text-slate-400">
                          / {formatDuration(detail.durationSeconds)}
                        </span>
                      </span>
                      <input
                        className="timeline-range flex-1"
                        aria-label="回放进度"
                        type="range"
                        min={0}
                        max={Math.max(0, track.length - 1)}
                        step={0.01}
                        value={playbackPosition}
                        disabled={detailRefreshing}
                        aria-valuetext={`${formatDuration(elapsedSeconds)}，共 ${formatDuration(detail.durationSeconds)}`}
                        style={{ "--progress": `${progress}%` } as CSSProperties}
                        onChange={(event) => {
                          setIsPlaying(false);
                          seekPlayback(Number(event.target.value));
                        }}
                      />
                      <PlaybackRateControl
                        value={playbackRate}
                        disabled={track.length <= 1 || detailRefreshing}
                        onChange={setPlaybackRate}
                      />
                    </div>
                    <div className="mt-4 flex items-end gap-6">
                      <div className="w-[112px] pb-2">
                        <p className="text-xs font-semibold text-slate-500">当前速度</p>
                        <div className="mt-1 flex items-baseline gap-1">
                          <strong className="text-[43px] leading-none font-[720] tracking-[-0.035em] text-[#172332]">
                            {Math.round(activePoint?.speed ?? 0)}
                          </strong>
                          <span className="text-xs font-semibold text-slate-500">km/h</span>
                        </div>
                      </div>
                      <SpeedChart
                        track={track}
                        playbackPosition={playbackPosition}
                        onSeek={(position) => {
                          setIsPlaying(false);
                          seekPlayback(position);
                        }}
                      />
                    </div>
                    <SpeedZoneDistribution
                      track={track}
                      activeSpeed={activePoint?.speed ?? 0}
                      onSeek={(position) => {
                        setIsPlaying(false);
                        seekPlayback(position);
                      }}
                    />
                  </section>
                </>
              ) : (
                <section className="empty-month-panel" aria-live="polite">
                  {loading ? (
                    <LoaderCircle size={22} className="animate-spin text-[#0a9f92]" />
                  ) : (
                    <CalendarDays size={22} />
                  )}
                  <div>
                    <strong>
                      {loading
                        ? `正在读取${formatMonth(month)}`
                        : rides.length > 0
                          ? "选择一条行程查看轨迹"
                          : `${formatMonth(month)}没有行程`}
                    </strong>
                    <p>
                      {loading
                        ? "正在从九号账号读取这个月的骑行记录。"
                        : error
                          ? "读取失败，请检查网络后重新尝试。"
                          : rides.length > 0
                            ? "当前只加载了月度列表；选择左侧具体行程后才会读取 GPS 轨迹。"
                            : "可以从左侧选择其他年份和月份继续查看。"}
                    </p>
                  </div>
                  {!loading && error && mode === "live" ? (
                    <button
                      type="button"
                      onClick={() => void loadLiveData(month, vehicle, { refresh: true })}
                    >
                      <RefreshCw size={14} />
                      重新读取
                    </button>
                  ) : null}
                </section>
              )}
            </>
          )}
        </div>
      </main>

      {loginOpen ? (
        <LoginSheet
          open
          busy={loginBusy}
          error={error}
          onClose={() => {
            setLoginOpen(false);
            setError(null);
          }}
          onPasswordSubmit={login}
          onRequestSmsCode={requestSmsCode}
          onSmsCodeSubmit={loginWithSmsCode}
          onClearError={() => setError(null)}
        />
      ) : null}
      {exportOpen && detail ? (
        <RideExportSheet
          open
          busy={exportBusy}
          activeFormat={exportFormat}
          error={exportError}
          vehicleName={vehicle.name}
          detail={detail}
          onClose={() => {
            setExportOpen(false);
            setExportError(null);
          }}
          onExport={exportRide}
        />
      ) : null}
      <MonthSummaryExportSheet
        open={monthExportOpen}
        busy={monthExportBusy}
        activeFormat={monthExportFormat}
        error={monthExportError}
        vehicleName={vehicle.name}
        month={month}
        rideCount={rideMonthSummary.rideCount}
        visibleRideCount={rideMonthSummary.visibleRideCount}
        verifiedSpeedCount={verifiedSpeedCount}
        unresolvedCappedSpeedCount={unresolvedSpeedPlaceholderCount}
        ridesTruncated={rideMonthSummary.ridesTruncated}
        onClose={() => {
          setMonthExportOpen(false);
          setMonthExportError(null);
        }}
        onExport={exportMonthSummary}
      />
      <YearSummaryExportSheet
        open={yearExportOpen}
        busy={yearExportBusy}
        activeFormat={yearExportFormat}
        error={yearExportError}
        vehicleName={vehicle.name}
        year={statisticsYear}
        monthCount={statisticsSourceMonths.length}
        onClose={() => {
          setYearExportOpen(false);
          setYearExportError(null);
        }}
        onExport={exportYearSummary}
      />
      <SecuritySheet
        open={securityOpen}
        busy={securityBusy}
        error={securityError}
        status={securityStatus}
        profile={accountProfile}
        profileError={accountProfileError}
        onClose={() => {
          setSecurityOpen(false);
          setSecurityError(null);
          setAccountProfileError(null);
        }}
        onRefresh={loadSecurityStatus}
        onLogout={logout}
      />
    </div>
  );
}

interface NavItemProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

const NavItem = ({ icon, label, active = false, onClick }: NavItemProps) => {
  const content = (
    <>
      {icon}
      <span>{label}</span>
    </>
  );

  if (onClick) {
    return (
      <button
        className={`nav-item ${active ? "nav-item-active" : ""}`}
        type="button"
        onClick={onClick}
        aria-current={active ? "page" : undefined}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={`nav-item ${active ? "nav-item-active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      {content}
    </div>
  );
};

interface MetricProps {
  label: string;
  value: string;
  unit?: string | undefined;
}

const Metric = ({ label, value, unit }: MetricProps) => (
  <div className="min-w-0">
    <p className="text-[11px] font-semibold text-slate-500">{label}</p>
    <p className="mt-1 truncate text-[14px] font-[680] tabular-nums text-[#283645]">
      {value}
      {unit ? <span className="ml-1 text-[10px] font-semibold text-slate-500">{unit}</span> : null}
    </p>
  </div>
);
