import type {
  AccountProfile,
  BatteryPackSummary,
  RideDaySummary,
  RideDetail,
  RideMonth,
  RideSummary,
  TrackPoint,
  VehicleLocation,
  VehicleLocationRead,
  VehicleSnapshot,
  VehicleSummary,
} from "../shared/contracts.js";

type JsonRecord = Record<string, unknown>;

export interface ParsedVehicle extends Omit<VehicleSummary, "id"> {
  serialNumber: string;
}

export interface ParsedRide extends Omit<RideSummary, "id"> {
  travelId: string;
}

const asRecord = (value: unknown): JsonRecord | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
};

const toNumber = (value: unknown, fallback = 0) => {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toOptionalNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const toOptionalNonnegativeNumber = (value: unknown) => {
  const numeric = toOptionalNumber(value);
  return numeric !== null && numeric >= 0 ? numeric : null;
};

const toOptionalPercentage = (value: unknown) => {
  const numeric = toOptionalNumber(value);
  return numeric !== null && numeric >= 0 && numeric <= 100 ? numeric : null;
};

const toFlag = (value: unknown) => value === true || value === 1 || value === "1";

const toOptionalFlag = (value: unknown) => {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
};

const toText = (value: unknown, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const toOptionalText = (value: unknown, maximumLength = 64) => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, maximumLength) : null;
};

const toUnixSeconds = (value: unknown) => {
  const numeric = toOptionalNonnegativeNumber(value);
  if (numeric === null || numeric === 0) return null;
  const seconds = numeric > 10_000_000_000 ? numeric / 1000 : numeric;
  // Reject obvious sentinels and corrupt timestamps outside 2000–2200.
  return seconds >= 946_684_800 && seconds <= 7_258_118_400 ? Math.round(seconds) : null;
};

const parseBatteryChemistry = (value: unknown) =>
  value === 1 || value === "1" ? ("lithium" as const) : null;

const maskPhone = (phone: string, areaCode: string) => {
  const areaDigits = areaCode.replace(/\D/g, "");
  let phoneDigits = phone.replace(/\D/g, "");
  if (areaDigits && phoneDigits.startsWith(areaDigits) && phoneDigits.length > 11) {
    phoneDigits = phoneDigits.slice(areaDigits.length);
  }
  if (!phoneDigits) return null;
  const maskedPhone =
    phoneDigits.length >= 7
      ? `${phoneDigits.slice(0, 3)}****${phoneDigits.slice(-4)}`
      : `${phoneDigits[0] ?? ""}${"*".repeat(Math.max(3, phoneDigits.length - 1))}`;
  return areaDigits ? `+${areaDigits} ${maskedPhone}` : maskedPhone;
};

const maskEmail = (email: string) => {
  const separatorIndex = email.lastIndexOf("@");
  if (separatorIndex <= 0 || separatorIndex === email.length - 1) return null;
  return `${email[0]}***${email.slice(separatorIndex)}`;
};

const maskUsername = (username: string) => {
  const characters = [...username];
  if (characters.length === 0) return null;
  if (characters.length === 1) return "*";
  return `${characters[0]}***${characters.at(-1)}`;
};

/** Extracts only a masked account hint from ninecli whoami and discards all raw identifiers. */
export const parseAccountProfile = (payload: unknown): AccountProfile => {
  const wrapper = asRecord(payload) ?? {};
  const profile = asRecord(wrapper.data) ?? wrapper;
  const areaCode = toText(profile.areaCode);
  const phone = toText(profile.phone);
  const email = toText(profile.email);
  const username = toText(profile.username);

  const maskedPhone = phone ? maskPhone(phone, areaCode) : null;
  if (maskedPhone) {
    return {
      maskedIdentifier: maskedPhone,
      identifierKind: "phone",
      passwordConfigured: typeof profile.hasPassword === "boolean" ? profile.hasPassword : null,
    };
  }

  const maskedEmail = email ? maskEmail(email) : null;
  if (maskedEmail) {
    return {
      maskedIdentifier: maskedEmail,
      identifierKind: "email",
      passwordConfigured: typeof profile.hasPassword === "boolean" ? profile.hasPassword : null,
    };
  }

  return {
    maskedIdentifier: username ? maskUsername(username) : null,
    identifierKind: username ? "username" : "unknown",
    passwordConfigured: typeof profile.hasPassword === "boolean" ? profile.hasPassword : null,
  };
};

/** Converts a Ninebot trail string into renderer-safe numeric samples. */
export const parseTrail = (value: unknown, durationSeconds: number): TrackPoint[] => {
  if (typeof value !== "string") return [];

  const rawPoints = value
    .split(";")
    .map((entry) => entry.split(","))
    .filter((fields) => fields.length >= 3)
    .map((fields) => ({
      longitude: Number(fields[0]),
      latitude: Number(fields[1]),
      speed: Number(fields[2]),
    }))
    .filter(
      ({ longitude, latitude, speed }) =>
        Number.isFinite(longitude) && Number.isFinite(latitude) && Number.isFinite(speed),
    );

  const denominator = Math.max(1, rawPoints.length - 1);
  return rawPoints.map((point, index) => ({
    ...point,
    offsetSeconds: Math.round((index / denominator) * durationSeconds),
  }));
};

/** Extracts owned/shared vehicles without exposing unrelated account fields. */
export const parseVehicles = (payload: unknown): ParsedVehicle[] => {
  if (!Array.isArray(payload)) return [];

  return payload.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const serialNumber = toText(record.wnumber ?? record.sn);
    if (!serialNumber) return [];
    const activated = toOptionalFlag(record.actived);
    const activationTime = activated === false ? null : toUnixSeconds(record.active_date);
    const rawAuthorizationTime = activated === false ? null : toUnixSeconds(record.auth_date);
    const authorizationTime =
      rawAuthorizationTime !== null &&
      (activationTime === null || rawAuthorizationTime >= activationTime)
        ? rawAuthorizationTime
        : null;
    return [
      {
        serialNumber,
        name: toText(record.device_name ?? record.ble_name, "我的车辆"),
        model: toText(
          record.vehicle_name ?? record.vehicle_name_zh ?? record.vehicle_name_en,
          "九号车辆",
        ),
        access: toFlag(record.is_common_user) ? "shared" : "owner",
        activated,
        activationTime,
        authorizationTime,
        smartServiceRemainingDays: toOptionalNonnegativeNumber(record.smart_service_surplus_days),
      },
    ];
  });
};

/** Combines ninecli status and battery payloads without exposing location or identifiers. */
export const parseVehicleSnapshot = (
  statusPayload: unknown,
  batteryPayload: unknown,
  availability: VehicleSnapshot["availability"] = { status: true, battery: true },
): VehicleSnapshot => {
  const status = asRecord(statusPayload) ?? {};
  const battery = asRecord(batteryPayload) ?? {};
  const location = asRecord(status.loc) ?? {};
  const batteryMain = asRecord(battery.battery_main) ?? {};
  const rawBatteryPacks = Array.isArray(battery.battery_list) ? battery.battery_list : [];
  const batteryPacks: BatteryPackSummary[] = rawBatteryPacks.flatMap((item, index) => {
    const pack = asRecord(item);
    if (!pack) return [];
    return [
      {
        id: `battery-${index + 1}`,
        electricityPercent: toOptionalPercentage(pack.electricity),
        voltageV: toOptionalNumber(pack.bms_volt),
        temperatureC: toOptionalNumber(pack.bat_temp),
        cycleCount: toOptionalNumber(pack.bms_cycle),
        score: toOptionalNumber(pack.score),
        cycleTip: toOptionalText(pack.bms_cycle_tips, 240)?.replace(/^\*\s*/, "") ?? null,
      },
    ];
  });
  const statusBatteryPercent = availability.status
    ? toOptionalPercentage(status.dump_energy)
    : null;
  const diagnosticBatteryPercent = availability.battery
    ? (toOptionalPercentage(battery.electricity) ??
      toOptionalPercentage(batteryMain.electricity) ??
      batteryPacks[0]?.electricityPercent ??
      null)
    : null;
  // The dedicated battery service is more diagnostic-rich; status.dump_energy keeps the
  // essential level visible when that independent upstream domain is temporarily unavailable.
  const batteryPercent = diagnosticBatteryPercent ?? statusBatteryPercent;
  const batteryPercentSource =
    diagnosticBatteryPercent !== null ? "battery" : statusBatteryPercent !== null ? "status" : null;
  const chargingFlags = [
    availability.battery ? toOptionalFlag(battery.charging) : null,
    availability.status ? toOptionalFlag(status.charging) : null,
  ].filter((flag): flag is boolean => flag !== null);
  const explicitBatteryPresence = availability.status ? toOptionalFlag(status.battery_exist) : null;
  const batteryListPresent = availability.battery && Array.isArray(battery.battery_list);
  return {
    availability,
    batteryPercent,
    batteryPercentSource,
    statusBatteryPercent,
    diagnosticBatteryPercent,
    charging: chargingFlags.length > 0 ? chargingFlags.some(Boolean) : null,
    batteryPresent:
      explicitBatteryPresence ?? (batteryListPresent ? batteryPacks.length > 0 : null),
    poweredOn: toOptionalFlag(status.pwr),
    ignitionOn: toOptionalFlag(location.acc),
    locked: toOptionalFlag(location.lock),
    batteryChemistry: parseBatteryChemistry(battery.battery_type),
    smartServiceExpired: toOptionalFlag(status.is_smart_service_expired),
    aiEstimatedRangeKm: toOptionalNumber(status.ai_estimate_mileage),
    estimatedRangeKm: toOptionalNumber(status.estimate_mileage),
    preciseEstimatedRangeKm: toOptionalNumber(status.precise_estimate_mileage),
    remainingChargeTimeText:
      toOptionalText(status.remain_charge_time) ?? toOptionalText(battery.remain_charge_time),
    chargeCompletionTime: toUnixSeconds(status.remain_charge_timestamp),
    batteryPacks,
  };
};

/** Parses ninecli's month-wide daily mileage array while preserving unknown entries. */
export const parseRideDays = (value: unknown, requestedMonth: string): RideDaySummary[] => {
  if (!Array.isArray(value) || !/^\d{6}$/.test(requestedMonth)) return [];
  const year = Number(requestedMonth.slice(0, 4));
  const month = Number(requestedMonth.slice(4));
  if (!Number.isInteger(year) || month < 1 || month > 12) return [];
  const dayCount = new Date(year, month, 0).getDate();
  return Array.from({ length: dayCount }, (_, index) => ({
    day: index + 1,
    mileageKm: index < value.length ? toOptionalNonnegativeNumber(value[index]) : null,
  }));
};

/** Extracts sharing permission plus the minimum location state after explicit user consent. */
export const parseVehicleLocationRead = (statusPayload: unknown): VehicleLocationRead => {
  const status = asRecord(statusPayload) ?? {};
  const permissions = asRecord(status.permissions);
  const explicitPermission = permissions ? toOptionalFlag(permissions.see_location) : null;
  const location = asRecord(status.loc);
  let parsedLocation: VehicleLocation | null = null;
  if (location) {
    const longitude = toOptionalNumber(location.lon ?? location.longitude);
    const latitude = toOptionalNumber(location.lat ?? location.latitude);
    if (
      longitude !== null &&
      latitude !== null &&
      longitude >= -180 &&
      longitude <= 180 &&
      latitude >= -90 &&
      latitude <= 90 &&
      (longitude !== 0 || latitude !== 0)
    ) {
      parsedLocation = {
        longitude,
        latitude,
        locked: toFlag(location.lock),
        ignitionOn: toFlag(location.acc),
      };
    }
  }

  // An explicit sharing denial wins even if an inconsistent payload happens to include coordinates.
  if (explicitPermission === false) return { permission: "denied", location: null };
  return {
    permission: explicitPermission === true || parsedLocation ? "allowed" : "unknown",
    location: parsedLocation,
  };
};

/** Extracts ride list rows from Ninebot's monthly travel response. */
export const parseRides = (payload: unknown): ParsedRide[] => {
  const record = asRecord(payload);
  const list = record?.list;
  if (!Array.isArray(list)) return [];

  return list.flatMap((item) => {
    const ride = asRecord(item);
    if (!ride) return [];
    const travelId = toText(ride.travel_id ?? ride.travelId ?? ride.id);
    if (!travelId) return [];
    const mileageKm = toNumber(ride.mileages ?? ride.mileage);
    const rawDayMileageKm = toOptionalNonnegativeNumber(ride.day_total_mileage);
    const dayMileageKm =
      rawDayMileageKm !== null && rawDayMileageKm + 0.1 >= mileageKm ? rawDayMileageKm : null;
    return [
      {
        travelId,
        startTime: toNumber(ride.start_time ?? ride.startTime),
        endTime: toNumber(ride.end_time ?? ride.endTime),
        mileageKm,
        durationSeconds: toNumber(ride.duration),
        declaredMaxSpeed: Number.isFinite(Number(ride.speed)) ? Number(ride.speed) : null,
        energyWh: toOptionalNonnegativeNumber(ride.ec),
        batteryUsedPercent: toOptionalNonnegativeNumber(ride.used_electricity),
        dayMileageKm,
      },
    ];
  });
};

/** Preserves complete month totals even when ninecli caps the selectable ride rows. */
export const parseRideMonth = (
  payload: unknown,
  requestedMonth: string,
): Omit<RideMonth, "rides"> & { rides: ParsedRide[] } => {
  const record = asRecord(payload) ?? {};
  const rides = parseRides(payload);
  const days = parseRideDays(record.detail, requestedMonth);
  const upstreamRideCount = toOptionalNonnegativeNumber(record.times);
  const upstreamMileageKm = toOptionalNonnegativeNumber(record.total_mileages);
  const upstreamDurationSeconds = toOptionalNonnegativeNumber(record.duration);
  const upstreamEnergyWh = toOptionalNonnegativeNumber(record.ec);
  const aggregateAvailable =
    upstreamRideCount !== null &&
    Number.isInteger(upstreamRideCount) &&
    upstreamRideCount >= rides.length &&
    upstreamMileageKm !== null &&
    upstreamDurationSeconds !== null;
  const visibleMileageKm = rides.reduce((total, ride) => total + ride.mileageKm, 0);
  const visibleDurationSeconds = rides.reduce((total, ride) => total + ride.durationSeconds, 0);
  const visibleEnergyValues = rides.map(({ energyWh }) => energyWh);
  const visibleEnergyWh = visibleEnergyValues.every((energyWh) => energyWh !== null)
    ? visibleEnergyValues.reduce<number>((total, energyWh) => total + (energyWh ?? 0), 0)
    : null;
  const rideCount = aggregateAvailable ? upstreamRideCount : rides.length;
  const knownDayMileages = days.flatMap(({ mileageKm }) => (mileageKm === null ? [] : [mileageKm]));
  const dailyMileageComplete = days.length > 0 && knownDayMileages.length === days.length;

  return {
    summary: {
      month: requestedMonth,
      historyStartTime: toUnixSeconds(record.first_time),
      rideCount,
      mileageKm: aggregateAvailable ? upstreamMileageKm : visibleMileageKm,
      durationSeconds: aggregateAvailable ? upstreamDurationSeconds : visibleDurationSeconds,
      energyWh: aggregateAvailable ? upstreamEnergyWh : visibleEnergyWh,
      visibleRideCount: rides.length,
      aggregateAvailable,
      ridesTruncated:
        (aggregateAvailable && rideCount > rides.length) ||
        (!aggregateAvailable && rides.length >= 20),
      activeDayCount: dailyMileageComplete
        ? knownDayMileages.filter((mileageKm) => mileageKm > 0).length
        : null,
      longestDayMileageKm:
        dailyMileageComplete && knownDayMileages.length > 0 ? Math.max(...knownDayMileages) : null,
    },
    days,
    rides,
  };
};

/** Builds the normalized ride detail consumed by both the chart and route canvas. */
export const parseRideDetail = (
  payload: unknown,
  id: string,
  dayMileageKm: number | null = null,
): RideDetail => {
  const record = asRecord(payload) ?? {};
  const durationSeconds = toNumber(record.duration);
  const mileageKm = toNumber(record.mileages ?? record.mileage);
  const track = parseTrail(record.trail, durationSeconds);
  const sampledMaxSpeed = track.length > 0 ? Math.max(...track.map(({ speed }) => speed)) : null;
  const declaredMaxSpeed = Number.isFinite(Number(record.speed)) ? Number(record.speed) : null;
  const upstreamAverage = toNumber(record.avg_speed);
  const calculatedAverage = durationSeconds > 0 ? mileageKm / (durationSeconds / 3600) : 0;

  return {
    id,
    startTime: toNumber(record.start_time),
    endTime: toNumber(record.end_time),
    mileageKm,
    durationSeconds,
    declaredMaxSpeed,
    energyWh: toOptionalNonnegativeNumber(record.ec),
    batteryUsedPercent: toOptionalNonnegativeNumber(record.used_electricity),
    dayMileageKm: dayMileageKm !== null && dayMileageKm + 0.1 >= mileageKm ? dayMileageKm : null,
    averageSpeed: upstreamAverage > 0 ? upstreamAverage : calculatedAverage,
    sampledMaxSpeed,
    track,
  };
};
