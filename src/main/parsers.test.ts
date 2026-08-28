import { describe, expect, it } from "vitest";
import {
  parseAccountProfile,
  parseRideDetail,
  parseRideDays,
  parseRideMonth,
  parseRides,
  parseTrail,
  parseVehicleLocationRead,
  parseVehicleSnapshot,
  parseVehicles,
} from "./parsers.js";

describe("Ninebot response parsers", () => {
  it("keeps only a masked account hint from whoami", () => {
    const profile = parseAccountProfile({
      data: {
        areaCode: "86",
        phone: "13800138000",
        email: "private@example.com",
        username: "PrivateName",
        uuid: "PRIVATE-UUID",
        avatar: "https://private.example/avatar.png",
        weixinOpenid: "PRIVATE-OPENID",
        hasPassword: true,
      },
    });

    expect(profile).toEqual({
      maskedIdentifier: "+86 138****8000",
      identifierKind: "phone",
      passwordConfigured: true,
    });
    const serialized = JSON.stringify(profile);
    expect(serialized).not.toContain("13800138000");
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("PrivateName");
    expect(serialized).not.toContain("PRIVATE-UUID");
    expect(serialized).not.toContain("PRIVATE-OPENID");
    expect(serialized).not.toContain("avatar.png");
  });

  it("falls back to masked email or username without inventing password state", () => {
    expect(parseAccountProfile({ data: { email: "rider@example.com" } })).toEqual({
      maskedIdentifier: "r***@example.com",
      identifierKind: "email",
      passwordConfigured: null,
    });
    expect(parseAccountProfile({ username: "韭号出行用户" })).toEqual({
      maskedIdentifier: "韭***户",
      identifierKind: "username",
      passwordConfigured: null,
    });
  });

  it("keeps only the vehicle fields required by the renderer", () => {
    expect(
      parseVehicles([
        {
          wnumber: "PRIVATE-SERIAL",
          device_name: "F90",
          vehicle_name_zh: "九号电动自行车",
          is_common_user: 0,
          actived: 1,
          active_date: 1_735_689_600,
          auth_date: 1_735_689_600,
          smart_service_surplus_days: 186,
          owner_user_phone: "PRIVATE",
        },
        {
          wnumber: "PRIVATE-SHARED-SERIAL",
          device_name: "E125",
          vehicle_name: "九号电动摩托车",
          is_common_user: 1,
          actived: "1",
          active_date: "1704067200",
          auth_date: "1738281600",
          smart_service_surplus_days: "42",
          shared_user_phone: "PRIVATE",
        },
      ]),
    ).toEqual([
      {
        serialNumber: "PRIVATE-SERIAL",
        name: "F90",
        model: "九号电动自行车",
        access: "owner",
        activated: true,
        activationTime: 1_735_689_600,
        authorizationTime: 1_735_689_600,
        smartServiceRemainingDays: 186,
      },
      {
        serialNumber: "PRIVATE-SHARED-SERIAL",
        name: "E125",
        model: "九号电动摩托车",
        access: "shared",
        activated: true,
        activationTime: 1_704_067_200,
        authorizationTime: 1_738_281_600,
        smartServiceRemainingDays: 42,
      },
    ]);
  });

  it("rejects lifecycle timestamps that contradict activation state or ordering", () => {
    expect(
      parseVehicles([
        {
          wnumber: "INACTIVE",
          actived: 0,
          active_date: 1_735_689_600,
          auth_date: 1_735_689_600,
        },
        {
          wnumber: "OUT-OF-ORDER",
          is_common_user: 1,
          actived: 1,
          active_date: 1_735_689_600,
          auth_date: 1_704_067_200,
        },
      ]),
    ).toMatchObject([
      { activated: false, activationTime: null, authorizationTime: null },
      { activated: true, activationTime: 1_735_689_600, authorizationTime: null },
    ]);
  });

  it("parses the semicolon trail and derives time offsets", () => {
    expect(parseTrail("116.1,39.1,0,1;116.2,39.2,42,1;116.3,39.3,70,1", 100)).toEqual([
      { longitude: 116.1, latitude: 39.1, speed: 0, offsetSeconds: 0 },
      { longitude: 116.2, latitude: 39.2, speed: 42, offsetSeconds: 50 },
      { longitude: 116.3, latitude: 39.3, speed: 70, offsetSeconds: 100 },
    ]);
  });

  it("prefers the declared max and calculates average speed when avg_speed is zero", () => {
    const detail = parseRideDetail(
      {
        speed: "71",
        avg_speed: 0,
        mileages: "12.6",
        duration: 1529,
        ec: "345",
        used_electricity: 6,
        start_time: 100,
        end_time: 1629,
        trail: "116.1,39.1,0,1;116.2,39.2,70,1",
      },
      "ride-1",
    );
    expect(detail.declaredMaxSpeed).toBe(71);
    expect(detail.sampledMaxSpeed).toBe(70);
    expect(detail.averageSpeed).toBeCloseTo(29.67, 2);
    expect(detail.energyWh).toBe(345);
    expect(detail.batteryUsedPercent).toBe(6);
  });

  it("parses monthly ride list rows", () => {
    expect(
      parseRides({
        list: [
          {
            travel_id: "travel-private",
            mileages: "12.60",
            duration: 1529,
            speed: "71.00",
            ec: "345",
            used_electricity: "6",
            start_time: 100,
            end_time: 1629,
          },
        ],
      }),
    ).toEqual([
      {
        travelId: "travel-private",
        mileageKm: 12.6,
        durationSeconds: 1529,
        declaredMaxSpeed: 71,
        energyWh: 345,
        batteryUsedPercent: 6,
        dayMileageKm: null,
        startTime: 100,
        endTime: 1629,
      },
    ]);
  });

  it("preserves a consistent complete day mileage and rejects contradictory values", () => {
    const [valid, invalid] = parseRides({
      list: [
        { travel_id: "valid", mileages: "12.6", day_total_mileage: "39.4" },
        { travel_id: "invalid", mileages: "12.6", day_total_mileage: "10.2" },
      ],
    });

    expect(valid?.dayMileageKm).toBe(39.4);
    expect(invalid?.dayMileageKm).toBeNull();
    expect(parseRideDetail({ mileages: 12.6 }, "ride-1", 39.4).dayMileageKm).toBe(39.4);
    expect(parseRideDetail({ mileages: 12.6 }, "ride-2", 10.2).dayMileageKm).toBeNull();
  });

  it("preserves complete daily mileage and unknown calendar entries", () => {
    const days = parseRideDays(["3.2", 0, "invalid", 8.4], "202602");
    expect(days).toHaveLength(28);
    expect(days.slice(0, 5)).toEqual([
      { day: 1, mileageKm: 3.2 },
      { day: 2, mileageKm: 0 },
      { day: 3, mileageKm: null },
      { day: 4, mileageKm: 8.4 },
      { day: 5, mileageKm: null },
    ]);
    expect(parseRideDays([], "invalid")).toEqual([]);
    expect(
      parseRideMonth({ times: 1, total_mileages: 3.2, duration: 300, detail: [3.2] }, "202602")
        .summary,
    ).toMatchObject({ activeDayCount: null, longestDayMileageKm: null });
  });

  it("keeps complete month aggregates when selectable rides are capped", () => {
    const parsed = parseRideMonth(
      {
        times: 42,
        total_mileages: "236.8",
        duration: 28_400,
        ec: 6_320,
        first_time: 1_763_793_834,
        detail: [0, 12.4, 0, 35.9, ...Array.from({ length: 27 }, () => 0)],
        list: Array.from({ length: 20 }, (_, index) => ({
          travel_id: `travel-${index}`,
          mileages: "5",
          duration: 600,
          ec: "140",
          used_electricity: "3",
        })),
      },
      "202608",
    );

    expect(parsed.summary).toEqual({
      month: "202608",
      historyStartTime: 1_763_793_834,
      rideCount: 42,
      mileageKm: 236.8,
      durationSeconds: 28_400,
      energyWh: 6_320,
      visibleRideCount: 20,
      aggregateAvailable: true,
      ridesTruncated: true,
      activeDayCount: 2,
      longestDayMileageKm: 35.9,
    });
    expect(parsed.days).toHaveLength(31);
    expect(parsed.rides).toHaveLength(20);
  });

  it("falls back to visible rows when month aggregates are unavailable", () => {
    expect(
      parseRideMonth(
        {
          list: [
            {
              travel_id: "travel-visible",
              mileages: "6.5",
              duration: 900,
              ec: "180",
            },
          ],
        },
        "202607",
      ).summary,
    ).toEqual({
      month: "202607",
      historyStartTime: null,
      rideCount: 1,
      mileageKm: 6.5,
      durationSeconds: 900,
      energyWh: 180,
      visibleRideCount: 1,
      aggregateAvailable: false,
      ridesTruncated: false,
      activeDayCount: null,
      longestDayMileageKm: null,
    });
  });

  it("keeps missing or invalid ride energy explicit instead of inventing zero", () => {
    expect(
      parseRideDetail(
        {
          duration: 60,
          mileages: "1.2",
          ec: -1,
          used_electricity: "unknown",
        },
        "ride-without-energy",
      ),
    ).toEqual(
      expect.objectContaining({
        energyWh: null,
        batteryUsedPercent: null,
      }),
    );
  });

  it("combines read-only status and battery telemetry without location or identifiers", () => {
    expect(
      parseVehicleSnapshot(
        {
          battery_exist: 1,
          charging: 0,
          ai_estimate_mileage: 38.3,
          estimate_mileage: 135.1,
          precise_estimate_mileage: 149.4,
          remain_charge_time: "",
          remain_charge_timestamp: 1_800_000_000,
          is_smart_service_expired: 0,
          dump_energy: "56",
          pwr: 1,
          sn: "PRIVATE-SERIAL",
          loc: { acc: 0, lock: 1, lat: "PRIVATE", lon: "PRIVATE" },
        },
        {
          charging: 0,
          electricity: 61,
          battery_type: "1",
          remain_charge_time: "1小时20分钟",
          battery_list: [
            {
              bat_temp: "28",
              bms_cycle: "3",
              bms_volt: "53.2",
              electricity: "61",
              score: 100,
              bms_cycle_tips: "* 新车激活时 0~5 次循环属于正常现象。",
            },
          ],
        },
      ),
    ).toEqual({
      availability: { status: true, battery: true },
      batteryPercent: 61,
      batteryPercentSource: "battery",
      statusBatteryPercent: 56,
      diagnosticBatteryPercent: 61,
      charging: false,
      batteryPresent: true,
      poweredOn: true,
      ignitionOn: false,
      locked: true,
      batteryChemistry: "lithium",
      smartServiceExpired: false,
      aiEstimatedRangeKm: 38.3,
      estimatedRangeKm: 135.1,
      preciseEstimatedRangeKm: 149.4,
      remainingChargeTimeText: "1小时20分钟",
      chargeCompletionTime: 1_800_000_000,
      batteryPacks: [
        {
          id: "battery-1",
          electricityPercent: 61,
          voltageV: 53.2,
          temperatureC: 28,
          cycleCount: 3,
          score: 100,
          cycleTip: "新车激活时 0~5 次循环属于正常现象。",
        },
      ],
    });
  });

  it("keeps unsupported diagnostics explicit without treating ACC as main power", () => {
    expect(
      parseVehicleSnapshot(
        {
          loc: { acc: 1, lock: 0 },
          remain_charge_timestamp: 42,
        },
        {
          battery_type: "unknown",
          battery_list: [{ bms_cycle_tips: "" }],
        },
      ),
    ).toMatchObject({
      poweredOn: null,
      ignitionOn: true,
      batteryChemistry: null,
      batteryPercent: null,
      batteryPercentSource: null,
      statusBatteryPercent: null,
      diagnosticBatteryPercent: null,
      smartServiceExpired: null,
      chargeCompletionTime: null,
      batteryPacks: [{ cycleTip: null }],
    });
  });

  it("rejects impossible battery percentages from both read-only domains", () => {
    expect(
      parseVehicleSnapshot(
        { dump_energy: "101" },
        { electricity: -1, battery_list: [{ electricity: "not-a-number" }] },
      ),
    ).toMatchObject({
      batteryPercent: null,
      batteryPercentSource: null,
      statusBatteryPercent: null,
      diagnosticBatteryPercent: null,
    });
  });

  it("extracts a valid location only when explicitly parsed", () => {
    expect(
      parseVehicleLocationRead({
        sn: "PRIVATE-SERIAL",
        loc: { lon: "116.31", lat: "39.91", lock: 1, acc: 0 },
      }),
    ).toEqual({
      permission: "allowed",
      location: { longitude: 116.31, latitude: 39.91, locked: true, ignitionOn: false },
    });
    expect(parseVehicleLocationRead({ loc: { lon: "0", lat: "0" } })).toEqual({
      permission: "unknown",
      location: null,
    });
    expect(parseVehicleLocationRead({ loc: { lon: "invalid", lat: "39.91" } })).toEqual({
      permission: "unknown",
      location: null,
    });
  });

  it("honors an explicit shared-location denial even if coordinates are present", () => {
    expect(
      parseVehicleLocationRead({
        permissions: { see_location: false },
        loc: { lon: "116.31", lat: "39.91", lock: 1, acc: 0 },
      }),
    ).toEqual({ permission: "denied", location: null });
    expect(parseVehicleLocationRead({ permissions: { see_location: true }, loc: null })).toEqual({
      permission: "allowed",
      location: null,
    });
  });
});
