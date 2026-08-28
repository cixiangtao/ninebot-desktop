import type { RideDetail, RideExportFormat } from "../shared/contracts.js";

const invalidFileNameCharacters = /[<>:"/\\|?*]/g;

const replaceControlCharacters = (value: string) =>
  [...value].map((character) => (character.charCodeAt(0) < 32 ? "-" : character)).join("");

const formatTimestampForFileName = (unixSeconds: number) => {
  const date = new Date(unixSeconds * 1_000);
  if (!Number.isFinite(date.getTime())) return "unknown-time";
  return date.toISOString().replace(/[:T]/g, "-").slice(0, 16);
};

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

/** Creates a filesystem-safe base name while preserving readable Chinese vehicle names. */
export const sanitizeExportBaseName = (value: string) => {
  const normalized = replaceControlCharacters(value)
    .normalize("NFKC")
    .replace(invalidFileNameCharacters, "-")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+/g, "")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 80);
  return normalized || "骑迹行程";
};

const createExportBaseName = (vehicleName: string, detail: RideDetail) =>
  sanitizeExportBaseName(`骑迹-${vehicleName}-${formatTimestampForFileName(detail.startTime)}`);

const createGpx = (vehicleName: string, detail: RideDetail) => {
  const name = escapeXml(`${vehicleName} 骑行轨迹`);
  const rideExtensions = [
    detail.energyWh === null
      ? null
      : `      <qiji:energy unit="Wh">${detail.energyWh}</qiji:energy>`,
    detail.batteryUsedPercent === null
      ? null
      : `      <qiji:battery-used unit="percent">${detail.batteryUsedPercent}</qiji:battery-used>`,
    detail.dayMileageKm === null
      ? null
      : `      <qiji:day-mileage unit="km">${detail.dayMileageKm}</qiji:day-mileage>`,
  ].filter((line): line is string => line !== null);
  const points = detail.track
    .map(({ latitude, longitude, offsetSeconds, speed }) => {
      const timestamp = new Date((detail.startTime + offsetSeconds) * 1_000).toISOString();
      return [
        `      <trkpt lat="${latitude}" lon="${longitude}">`,
        `        <time>${timestamp}</time>`,
        "        <extensions>",
        `          <qiji:speed unit="km/h">${speed}</qiji:speed>`,
        "        </extensions>",
        "      </trkpt>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Qiji" xmlns="http://www.topografix.com/GPX/1/1" xmlns:qiji="https://github.com/anys/qiji">',
    "  <metadata>",
    `    <name>${name}</name>`,
    `    <time>${new Date(detail.startTime * 1_000).toISOString()}</time>`,
    ...(rideExtensions.length > 0
      ? ["    <extensions>", ...rideExtensions, "    </extensions>"]
      : []),
    "  </metadata>",
    "  <trk>",
    `    <name>${name}</name>`,
    "    <trkseg>",
    points,
    "    </trkseg>",
    "  </trk>",
    "</gpx>",
    "",
  ].join("\n");
};

const createCsv = (detail: RideDetail) => {
  const rows = detail.track.map(({ latitude, longitude, offsetSeconds, speed }) =>
    [
      new Date((detail.startTime + offsetSeconds) * 1_000).toISOString(),
      offsetSeconds,
      longitude,
      latitude,
      speed,
      detail.energyWh ?? "",
      detail.batteryUsedPercent ?? "",
      detail.dayMileageKm ?? "",
    ].join(","),
  );
  return `\uFEFFtimestamp,elapsed_seconds,longitude,latitude,speed_kmh,ride_energy_wh,ride_battery_used_percent,day_mileage_km\r\n${rows.join("\r\n")}\r\n`;
};

const createJson = (vehicleName: string, detail: RideDetail) =>
  `${JSON.stringify(
    {
      schemaVersion: 2,
      exportedBy: "骑迹",
      vehicleName,
      ride: {
        startTime: detail.startTime,
        endTime: detail.endTime,
        mileageKm: detail.mileageKm,
        durationSeconds: detail.durationSeconds,
        energyWh: detail.energyWh,
        batteryUsedPercent: detail.batteryUsedPercent,
        dayMileageKm: detail.dayMileageKm,
        averageSpeedKmh: detail.averageSpeed,
        declaredMaxSpeedKmh: detail.declaredMaxSpeed,
        sampledMaxSpeedKmh: detail.sampledMaxSpeed,
        track: detail.track.map(({ latitude, longitude, offsetSeconds, speed }) => ({
          timestamp: new Date((detail.startTime + offsetSeconds) * 1_000).toISOString(),
          offsetSeconds,
          longitude,
          latitude,
          speedKmh: speed,
        })),
      },
    },
    null,
    2,
  )}\n`;

export interface RideExportDocument {
  content: string;
  fileName: string;
  format: RideExportFormat;
}

/** Serializes a normalized ride into a portable, user-selected export format. */
export const createRideExportDocument = (
  vehicleName: string,
  detail: RideDetail,
  format: RideExportFormat,
): RideExportDocument => {
  const fileName = `${createExportBaseName(vehicleName, detail)}.${format}`;
  if (format === "gpx") return { content: createGpx(vehicleName, detail), fileName, format };
  if (format === "csv") return { content: createCsv(detail), fileName, format };
  return { content: createJson(vehicleName, detail), fileName, format };
};
