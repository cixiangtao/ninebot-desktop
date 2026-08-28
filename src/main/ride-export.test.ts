import { describe, expect, it } from "vitest";
import type { RideDetail } from "../shared/contracts.js";
import { createRideExportDocument, sanitizeExportBaseName } from "./ride-export.js";

const ride = {
  id: "ride-1",
  startTime: 1_725_165_000,
  endTime: 1_725_165_120,
  mileageKm: 1.5,
  durationSeconds: 120,
  declaredMaxSpeed: 25,
  energyWh: 345,
  batteryUsedPercent: 6,
  dayMileageKm: 9.8,
  sampledMaxSpeed: 42,
  averageSpeed: 24.2,
  track: [
    { longitude: 116.31, latitude: 39.91, speed: 0, offsetSeconds: 0 },
    { longitude: 116.32, latitude: 39.92, speed: 42, offsetSeconds: 120 },
  ],
} satisfies RideDetail;

describe("ride export", () => {
  it("creates GPX with escaped metadata, timestamps, coordinates, and sampled speed", () => {
    const document = createRideExportDocument("F90 & <测试>", ride, "gpx");

    expect(document.fileName).toMatch(/^骑迹-F90 & -测试--2024-09-01-04-30\.gpx$/);
    expect(document.content).toContain("F90 &amp; &lt;测试&gt; 骑行轨迹");
    expect(document.content).toContain('<trkpt lat="39.92" lon="116.32">');
    expect(document.content).toContain('<qiji:speed unit="km/h">42</qiji:speed>');
    expect(document.content).toContain('<qiji:energy unit="Wh">345</qiji:energy>');
    expect(document.content).toContain('<qiji:battery-used unit="percent">6</qiji:battery-used>');
    expect(document.content).toContain('<qiji:day-mileage unit="km">9.8</qiji:day-mileage>');
    expect(document.content).toContain("2024-09-01T04:32:00.000Z");
  });

  it("creates an Excel-friendly CSV with stable numeric columns", () => {
    const document = createRideExportDocument("F90", ride, "csv");

    expect(document.content.startsWith("\uFEFFtimestamp,elapsed_seconds")).toBe(true);
    expect(document.content).toContain("2024-09-01T04:32:00.000Z,120,116.32,39.92,42,345,6,9.8");
  });

  it("creates versioned JSON without leaking the internal ride id", () => {
    const document = createRideExportDocument("F90", ride, "json");
    const payload = JSON.parse(document.content) as Record<string, unknown>;

    expect(payload).toMatchObject({ schemaVersion: 2, exportedBy: "骑迹", vehicleName: "F90" });
    expect(document.content).not.toContain('"id"');
    expect(document.content).toContain('"sampledMaxSpeedKmh": 42');
    expect(document.content).toContain('"energyWh": 345');
    expect(document.content).toContain('"batteryUsedPercent": 6');
    expect(document.content).toContain('"dayMileageKm": 9.8');
  });

  it("removes path separators and control characters from suggested names", () => {
    expect(sanitizeExportBaseName(" ../F90:\n轨迹?. ")).toBe("-F90--轨迹-");
    expect(sanitizeExportBaseName("   ")).toBe("骑迹行程");
  });
});
