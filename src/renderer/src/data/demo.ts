import type {
  RideDetail,
  RideSummary,
  TrackPoint,
  VehicleLocation,
  VehicleLocationPermission,
  VehicleSnapshot,
  VehicleSummary,
} from "../../../shared/contracts";

const now = Math.floor(Date.now() / 1000);
const demoActivationTime = Math.floor(new Date(2025, 0, 14).getTime() / 1000);
const demoSharedActivationTime = Math.floor(new Date(2024, 6, 9).getTime() / 1000);
const demoSharedAuthorizationTime = Math.floor(new Date(2026, 4, 8).getTime() / 1000);

const createDemoTrack = (): TrackPoint[] => {
  const anchorLongitude = 116.34;
  const anchorLatitude = 39.94;
  return Array.from({ length: 96 }, (_, index) => {
    const progress = index / 95;
    const longitude = anchorLongitude + progress * 0.075 + Math.sin(progress * Math.PI * 5) * 0.004;
    const latitude = anchorLatitude - progress * 0.026 + Math.cos(progress * Math.PI * 4) * 0.006;
    const envelope = Math.sin(progress * Math.PI);
    const speed = Math.max(0, 17 + envelope * 35 + Math.sin(progress * Math.PI * 12) * 8);
    return {
      longitude,
      latitude,
      speed: Math.round(speed),
      offsetSeconds: Math.round(progress * 1529),
    };
  });
};

export const demoVehicle: VehicleSummary = {
  id: "vehicle-1",
  name: "F90",
  model: "九号电动自行车",
  access: "owner",
  activated: true,
  activationTime: demoActivationTime,
  authorizationTime: demoActivationTime,
  smartServiceRemainingDays: 186,
};

export const demoVehicles: VehicleSummary[] = [
  demoVehicle,
  {
    id: "vehicle-2",
    name: "E125",
    model: "九号电动摩托车",
    access: "shared",
    activated: true,
    activationTime: demoSharedActivationTime,
    authorizationTime: demoSharedAuthorizationTime,
    smartServiceRemainingDays: 42,
  },
];

export const demoVehicleSnapshot: VehicleSnapshot = {
  availability: { status: true, battery: true },
  batteryPercent: 78,
  batteryPercentSource: "battery",
  statusBatteryPercent: 78,
  diagnosticBatteryPercent: 78,
  charging: false,
  batteryPresent: true,
  poweredOn: false,
  ignitionOn: false,
  locked: true,
  batteryChemistry: "lithium",
  smartServiceExpired: false,
  aiEstimatedRangeKm: 76.2,
  estimatedRangeKm: 82.4,
  preciseEstimatedRangeKm: 88.6,
  remainingChargeTimeText: null,
  chargeCompletionTime: null,
  batteryPacks: [
    {
      id: "battery-1",
      electricityPercent: 78,
      voltageV: 53.8,
      temperatureC: 27,
      cycleCount: 18,
      score: 98,
      cycleTip: "电池出厂前会进行测试，新车激活时 0～5 次循环属于正常现象。",
    },
  ],
};

export const demoVehicleSnapshots: Readonly<Record<string, VehicleSnapshot>> = {
  "vehicle-1": demoVehicleSnapshot,
  "vehicle-2": {
    availability: { status: true, battery: true },
    batteryPercent: 46,
    batteryPercentSource: "battery",
    statusBatteryPercent: 46,
    diagnosticBatteryPercent: 46,
    charging: true,
    batteryPresent: true,
    poweredOn: false,
    ignitionOn: false,
    locked: true,
    batteryChemistry: "lithium",
    smartServiceExpired: false,
    aiEstimatedRangeKm: 39.6,
    estimatedRangeKm: 41.8,
    preciseEstimatedRangeKm: 44.2,
    remainingChargeTimeText: "1小时25分钟",
    chargeCompletionTime: now + 5_100,
    batteryPacks: [
      {
        id: "battery-1",
        electricityPercent: 48,
        voltageV: 51.8,
        temperatureC: 29,
        cycleCount: 42,
        score: 94,
        cycleTip: "电池出厂前会进行测试，新车激活时 0～5 次循环属于正常现象。",
      },
      {
        id: "battery-2",
        electricityPercent: 44,
        voltageV: 51.4,
        temperatureC: 30,
        cycleCount: 45,
        score: 91,
        cycleTip: "电池出厂前会进行测试，新车激活时 0～5 次循环属于正常现象。",
      },
    ],
  },
};

export const demoVehicleLocations: Readonly<Record<string, VehicleLocation>> = {
  "vehicle-1": {
    longitude: 116.34,
    latitude: 39.94,
    locked: true,
    ignitionOn: false,
  },
  "vehicle-2": {
    longitude: 116.41,
    latitude: 39.91,
    locked: true,
    ignitionOn: false,
  },
};

export const demoVehicleLocationPermissions: Readonly<Record<string, VehicleLocationPermission>> = {
  "vehicle-1": "allowed",
  "vehicle-2": "denied",
};

export const demoRides: RideSummary[] = [
  {
    id: "ride-1",
    startTime: now - 2_400,
    endTime: now - 871,
    mileageKm: 12.6,
    durationSeconds: 1529,
    declaredMaxSpeed: 71,
    energyWh: 351,
    batteryUsedPercent: 6,
    dayMileageKm: 18.4,
  },
  {
    id: "ride-2",
    startTime: now - 91_000,
    endTime: now - 89_913,
    mileageKm: 8.3,
    durationSeconds: 1087,
    declaredMaxSpeed: 58,
    energyWh: 231,
    batteryUsedPercent: 4,
    dayMileageKm: 8.3,
  },
  {
    id: "ride-3",
    startTime: now - 174_000,
    endTime: now - 173_052,
    mileageKm: 6.7,
    durationSeconds: 948,
    declaredMaxSpeed: 52,
    energyWh: 188,
    batteryUsedPercent: 3,
    dayMileageKm: 6.7,
  },
  {
    id: "ride-4",
    startTime: now - 262_000,
    endTime: now - 260_667,
    mileageKm: 10.4,
    durationSeconds: 1333,
    declaredMaxSpeed: 64,
    energyWh: 291,
    batteryUsedPercent: 5,
    dayMileageKm: 10.4,
  },
  {
    id: "ride-5",
    startTime: now - 436_000,
    endTime: now - 435_008,
    mileageKm: 7.2,
    durationSeconds: 992,
    declaredMaxSpeed: 55,
    energyWh: 202,
    batteryUsedPercent: 4,
    dayMileageKm: 7.2,
  },
  {
    id: "ride-6",
    startTime: now - 610_000,
    endTime: now - 608_819,
    mileageKm: 9.1,
    durationSeconds: 1181,
    declaredMaxSpeed: 61,
    energyWh: 255,
    batteryUsedPercent: 5,
    dayMileageKm: 9.1,
  },
  {
    id: "ride-7",
    startTime: now - 784_000,
    endTime: now - 783_272,
    mileageKm: 5.6,
    durationSeconds: 728,
    declaredMaxSpeed: 49,
    energyWh: 157,
    batteryUsedPercent: 3,
    dayMileageKm: 5.6,
  },
];

const baseTrack = createDemoTrack();
const baseTrackMaximum = Math.max(...baseTrack.map(({ speed }) => speed));

/** Produces internally consistent synthetic detail data for visual development. */
export const createDemoDetail = (ride: RideSummary): RideDetail => {
  const targetSampledMaximum = Math.max(0, (ride.declaredMaxSpeed ?? baseTrackMaximum) - 1);
  const scale = targetSampledMaximum / baseTrackMaximum;
  const track = baseTrack.map((point, index) => ({
    ...point,
    speed: Math.round(point.speed * scale),
    offsetSeconds: Math.round((index / Math.max(1, baseTrack.length - 1)) * ride.durationSeconds),
  }));
  return {
    ...ride,
    averageSpeed: ride.durationSeconds > 0 ? ride.mileageKm / (ride.durationSeconds / 3600) : 0,
    sampledMaxSpeed: track.length > 0 ? Math.max(...track.map(({ speed }) => speed)) : null,
    track,
  };
};

export const demoDetail = createDemoDetail(demoRides[0]!);
