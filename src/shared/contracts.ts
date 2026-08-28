export const ipcChannels = {
  authStatus: "ninebot:auth:status",
  authProfile: "ninebot:auth:profile",
  passwordLogin: "ninebot:auth:password-login",
  requestSmsCode: "ninebot:auth:request-sms-code",
  smsCodeLogin: "ninebot:auth:sms-code-login",
  authLogout: "ninebot:auth:logout",
  runtimeSecurity: "ninebot:runtime:security",
  listVehicles: "ninebot:vehicles:list",
  getVehicleSnapshot: "ninebot:vehicles:snapshot",
  getVehicleLocation: "ninebot:vehicles:location",
  listRides: "ninebot:rides:list",
  getRideDetail: "ninebot:rides:detail",
  verifyRideSpeeds: "ninebot:rides:verify-speeds",
  exportRide: "ninebot:rides:export",
  exportMonthSummary: "ninebot:rides:export-month-summary",
  exportYearSummary: "ninebot:rides:export-year-summary",
} as const;

export interface BridgeError {
  code:
    | "AUTH_REQUIRED"
    | "HUMAN_VERIFICATION_REQUIRED"
    | "INVALID_INPUT"
    | "NINECLI_MISSING"
    | "NINECLI_INTEGRITY"
    | "UNSUPPORTED_PLATFORM"
    | "UPSTREAM_ERROR"
    | "UNKNOWN";
  message: string;
}

export type BridgeResult<T> = { ok: true; data: T } | { ok: false; error: BridgeError };

export interface AuthStatus {
  connected: boolean;
}

export interface AccountProfile {
  /** Renderer-safe masked identifier; the raw phone, email, username, and UUID stay in main. */
  maskedIdentifier: string | null;
  identifierKind: "phone" | "email" | "username" | "unknown";
  passwordConfigured: boolean | null;
}

export interface PasswordLoginInput {
  areaCode: string;
  user: string;
  password: string;
}

export interface SmsCodeRequestInput {
  areaCode: string;
  phone: string;
}

export interface SmsCodeLoginInput extends SmsCodeRequestInput {
  code: string;
}

export interface SmsCodeRequestStatus {
  sent: true;
}

export interface RuntimeSecurityStatus {
  version: string;
  binary: {
    status: "verified" | "mismatch" | "unsupported" | "unavailable";
    sha256: string | null;
    expectedSha256: string | null;
    platform: string;
    architecture: string;
  };
  storage: {
    directoryName: string;
    tokensPresent: boolean;
    permissions: "restricted" | "needs-attention" | "unavailable";
  };
  policy: {
    allowedCommands: readonly string[];
    environment: "minimal";
    passwordTransport: "process-arguments";
    smsCodeTransport: "process-arguments";
    vehicleControlsExposed: false;
    sessionCache: {
      storage: "memory-only";
      rawResponsesStored: false;
      persistsAcrossRestarts: false;
      manualRefreshBypasses: true;
    };
  };
}

export interface VehicleSummary {
  /** Opaque renderer-safe identifier; it is never the vehicle SN. */
  id: string;
  name: string;
  model: string;
  /** Account relationship only; owner identity and permissions remain in the main process. */
  access: "owner" | "shared";
  /** Explicit activation state returned by ninecli, or null when the field is unavailable. */
  activated: boolean | null;
  /** Vehicle activation time as Unix seconds after range and state validation. */
  activationTime: number | null;
  /** Account authorization/share time as Unix seconds, never earlier than activation. */
  authorizationTime: number | null;
  /** Remaining Ninebot smart-service entitlement days, when the vehicle list provides it. */
  smartServiceRemainingDays: number | null;
}

export interface BatteryPackSummary {
  /** Renderer-safe one-based identifier; it is not an upstream battery ID. */
  id: string;
  electricityPercent: number | null;
  voltageV: number | null;
  temperatureC: number | null;
  cycleCount: number | null;
  score: number | null;
  /** Upstream BMS guidance for interpreting the cycle count. */
  cycleTip: string | null;
}

/** Read-only vehicle and battery telemetry with identifiers and location removed. */
export interface VehicleSnapshot {
  availability: {
    status: boolean;
    battery: boolean;
  };
  /** Preferred battery percentage after applying the documented cross-domain fallback. */
  batteryPercent: number | null;
  /** The ninecli data domain that supplied `batteryPercent`. */
  batteryPercentSource: "battery" | "status" | null;
  /** Battery level from `status.dump_energy`, retained for provenance and fallback. */
  statusBatteryPercent: number | null;
  /** Battery level from the dedicated battery response, including its pack fallback. */
  diagnosticBatteryPercent: number | null;
  charging: boolean | null;
  batteryPresent: boolean | null;
  /** Main vehicle power from ninecli's top-level `pwr` field. */
  poweredOn: boolean | null;
  /** Accessory/ignition state from `status.loc.acc`, kept separate from main power. */
  ignitionOn: boolean | null;
  locked: boolean | null;
  batteryChemistry: "lithium" | null;
  smartServiceExpired: boolean | null;
  /** Ninebot's AI-assisted range estimate, when returned by the vehicle service. */
  aiEstimatedRangeKm: number | null;
  estimatedRangeKm: number | null;
  preciseEstimatedRangeKm: number | null;
  /** Upstream display text because ninecli does not document a stable numeric unit. */
  remainingChargeTimeText: string | null;
  /** Estimated charge completion as a Unix timestamp in seconds. */
  chargeCompletionTime: number | null;
  batteryPacks: BatteryPackSummary[];
}

/** On-demand vehicle position with upstream identifiers removed. */
export interface VehicleLocation {
  longitude: number;
  latitude: number;
  locked: boolean;
  /** Location payload only exposes ACC, not ninecli's top-level main-power state. */
  ignitionOn: boolean;
}

export type VehicleLocationPermission = "allowed" | "denied" | "unknown";

/** Result of an explicit location read, separating sharing permission from coordinate absence. */
export interface VehicleLocationRead {
  permission: VehicleLocationPermission;
  location: VehicleLocation | null;
}

export interface RideSummary {
  /** Opaque renderer-safe identifier; it is never the upstream travel_id. */
  id: string;
  startTime: number;
  endTime: number;
  mileageKm: number;
  durationSeconds: number;
  declaredMaxSpeed: number | null;
  /** Ride energy returned by ninecli's `ec` field, in watt-hours. */
  energyWh: number | null;
  /** Battery percentage consumed during the ride. */
  batteryUsedPercent: number | null;
  /** Complete mileage for the ride's calendar day from the monthly travel aggregate. */
  dayMileageKm: number | null;
}

/** Complete month totals plus the ride rows currently exposed by ninecli. */
export interface RideMonthSummary {
  /** Requested month in YYYYMM form. */
  month: string;
  /** Earliest ride timestamp returned by ninecli's month-wide `first_time` field. */
  historyStartTime: number | null;
  rideCount: number;
  mileageKm: number;
  durationSeconds: number;
  /** Complete month energy from ninecli's top-level `ec` field, in watt-hours. */
  energyWh: number | null;
  /** Number of ride rows available for selection, which can be lower than `rideCount`. */
  visibleRideCount: number;
  /** Whether count, mileage, and duration came from ninecli's complete month aggregate. */
  aggregateAvailable: boolean;
  /** Whether ninecli returned fewer selectable rows than the month contains. */
  ridesTruncated: boolean;
  /** Active calendar days derived from ninecli's complete monthly `detail` mileage array. */
  activeDayCount: number | null;
  /** Longest single-day mileage in the requested month. */
  longestDayMileageKm: number | null;
}

export interface RideDaySummary {
  /** One-based calendar day within the requested month. */
  day: number;
  /** Complete mileage for that day, or null when the upstream entry is invalid or missing. */
  mileageKm: number | null;
}

export interface RideMonth {
  summary: RideMonthSummary;
  /** Complete per-day mileage when ninecli exposes its monthly `detail` array. */
  days: RideDaySummary[];
  rides: RideSummary[];
}

export interface TrackPoint {
  longitude: number;
  latitude: number;
  speed: number;
  /** Estimated elapsed seconds because the upstream trail has no per-point timestamp. */
  offsetSeconds: number;
}

export interface RideDetail extends RideSummary {
  averageSpeed: number;
  sampledMaxSpeed: number | null;
  track: TrackPoint[];
}

export interface RideListInput {
  vehicleId: string;
  month: string;
  /** Bypasses the short-lived in-memory cache for an explicit user refresh. */
  refresh?: boolean;
}

export interface VehicleSnapshotInput {
  vehicleId: string;
  /** Bypasses the short-lived in-memory cache for an explicit user refresh. */
  refresh?: boolean;
}

export interface VehicleLocationInput {
  vehicleId: string;
}

export interface RideDetailInput {
  vehicleId: string;
  rideId: string;
  /** Bypasses the short-lived in-memory cache for an explicit current-ride refresh. */
  refresh?: boolean;
}

export interface RideSpeedVerificationInput {
  vehicleId: string;
  /** Opaque ids from the currently visible month, limited by ninecli to at most 20 rows. */
  rideIds: string[];
}

export interface RideSpeedVerification {
  /** Opaque renderer-safe ride id; no upstream travel id or GPS point crosses this bridge. */
  id: string;
  declaredMaxSpeed: number | null;
  sampledMaxSpeed: number | null;
}

export interface RideSpeedVerificationResult {
  rides: RideSpeedVerification[];
  /** Detail reads that failed with an ordinary upstream error while other rides succeeded. */
  failedRideCount: number;
}

export type RideExportFormat = "gpx" | "csv" | "json";

export interface RideExportInput {
  vehicleName: string;
  detail: RideDetail;
  format: RideExportFormat;
}

export interface RideExportResult {
  saved: boolean;
  /** Basename only; the renderer never receives the chosen directory path. */
  fileName: string | null;
}

export type YearSummaryExportFormat = "csv" | "json";

export type MonthSummaryExportFormat = "csv" | "json";

export interface MonthSummaryExportInput {
  vehicleName: string;
  /** Already-loaded month aggregate, daily mileage, and at most 20 selectable ride rows. */
  month: RideMonth;
  /** Optional track-derived maxima already verified during this renderer session. */
  speedVerifications: RideSpeedVerification[];
  format: MonthSummaryExportFormat;
}

export interface YearSummaryExportMonth {
  summary: RideMonthSummary;
  days: RideDaySummary[];
}

export interface YearSummaryExportInput {
  vehicleName: string;
  year: number;
  historyStartTime: number | null;
  /** Only month aggregates and daily mileage; never GPS points or upstream identifiers. */
  months: YearSummaryExportMonth[];
  format: YearSummaryExportFormat;
}

export interface NinebotBridge {
  auth: {
    status: () => Promise<BridgeResult<AuthStatus>>;
    profile: () => Promise<BridgeResult<AccountProfile>>;
    passwordLogin: (input: PasswordLoginInput) => Promise<BridgeResult<AuthStatus>>;
    requestSmsCode: (input: SmsCodeRequestInput) => Promise<BridgeResult<SmsCodeRequestStatus>>;
    smsCodeLogin: (input: SmsCodeLoginInput) => Promise<BridgeResult<AuthStatus>>;
    logout: () => Promise<BridgeResult<AuthStatus>>;
  };
  runtime: {
    security: () => Promise<BridgeResult<RuntimeSecurityStatus>>;
  };
  vehicles: {
    list: () => Promise<BridgeResult<VehicleSummary[]>>;
    snapshot: (input: VehicleSnapshotInput) => Promise<BridgeResult<VehicleSnapshot>>;
    location: (input: VehicleLocationInput) => Promise<BridgeResult<VehicleLocationRead>>;
  };
  rides: {
    list: (input: RideListInput) => Promise<BridgeResult<RideMonth>>;
    detail: (input: RideDetailInput) => Promise<BridgeResult<RideDetail>>;
    verifySpeeds: (
      input: RideSpeedVerificationInput,
    ) => Promise<BridgeResult<RideSpeedVerificationResult>>;
    export: (input: RideExportInput) => Promise<BridgeResult<RideExportResult>>;
    exportMonthSummary: (input: MonthSummaryExportInput) => Promise<BridgeResult<RideExportResult>>;
    exportYearSummary: (input: YearSummaryExportInput) => Promise<BridgeResult<RideExportResult>>;
  };
}
