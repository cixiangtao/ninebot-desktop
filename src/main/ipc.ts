import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { BrowserWindow, dialog, ipcMain, type FileFilter, type SaveDialogOptions } from "electron";
import { z } from "zod";
import {
  ipcChannels,
  type AccountProfile,
  type AuthStatus,
  type BridgeError,
  type BridgeResult,
  type MonthSummaryExportFormat,
  type RideDetail,
  type RideExportFormat,
  type RideExportResult,
  type RideMonth,
  type RideSpeedVerificationResult,
  type RuntimeSecurityStatus,
  type SmsCodeRequestStatus,
  type VehicleLocationRead,
  type VehicleSnapshot,
  type VehicleSummary,
  type YearSummaryExportFormat,
} from "../shared/contracts.js";
import { NineCliClient, NineCliError } from "./ninecli.js";
import { createMonthSummaryExportDocument } from "./month-summary-export.js";
import { createRideExportDocument } from "./ride-export.js";
import { loadRideSpeedVerifications } from "./ride-speed-verification.js";
import { createYearSummaryExportDocument } from "./year-summary-export.js";
import { SessionReadCache } from "./session-read-cache.js";
import { loadVehicleSnapshot } from "./vehicle-snapshot.js";
import {
  parseAccountProfile,
  parseRideDetail,
  parseRideMonth,
  parseVehicleLocationRead,
  parseVehicles,
} from "./parsers.js";

const passwordLoginSchema = z.object({
  areaCode: z.string().regex(/^\d{1,4}$/),
  user: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(256),
});

const smsCodeRequestSchema = z.object({
  areaCode: z.string().regex(/^\d{1,4}$/),
  phone: z
    .string()
    .trim()
    .regex(/^\d{5,20}$/),
});

const smsCodeLoginSchema = smsCodeRequestSchema.extend({
  code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/),
});

const rideListSchema = z.object({
  vehicleId: z.string().regex(/^vehicle-\d+$/),
  month: z.string().regex(/^\d{6}$/),
  refresh: z.boolean().optional().default(false),
});

const vehicleSnapshotSchema = z.object({
  vehicleId: z.string().regex(/^vehicle-\d+$/),
  refresh: z.boolean().optional().default(false),
});

const vehicleLocationSchema = z.object({
  vehicleId: z.string().regex(/^vehicle-\d+$/),
});

const rideDetailInputSchema = z.object({
  vehicleId: z.string().regex(/^vehicle-\d+$/),
  rideId: z.string().regex(/^ride-\d+$/),
  refresh: z.boolean().optional().default(false),
});

const rideSpeedVerificationSchema = z.object({
  vehicleId: z.string().regex(/^vehicle-\d+$/),
  rideIds: z
    .array(z.string().regex(/^ride-\d+$/))
    .min(1)
    .max(20)
    .refine((rideIds) => new Set(rideIds).size === rideIds.length),
});

const rideExportSchema = z.object({
  vehicleName: z.string().trim().min(1).max(100),
  format: z.enum(["gpx", "csv", "json"]),
  detail: z.object({
    id: z.string().min(1).max(100),
    startTime: z.number().finite().nonnegative(),
    endTime: z.number().finite().nonnegative(),
    mileageKm: z.number().finite().nonnegative(),
    durationSeconds: z.number().finite().nonnegative(),
    declaredMaxSpeed: z.number().finite().nullable(),
    energyWh: z.number().finite().nonnegative().nullable(),
    batteryUsedPercent: z.number().finite().nonnegative().nullable(),
    dayMileageKm: z.number().finite().nonnegative().nullable(),
    averageSpeed: z.number().finite().nonnegative(),
    sampledMaxSpeed: z.number().finite().nullable(),
    track: z
      .array(
        z.object({
          longitude: z.number().finite().min(-180).max(180),
          latitude: z.number().finite().min(-90).max(90),
          speed: z.number().finite().nonnegative(),
          offsetSeconds: z.number().finite().nonnegative(),
        }),
      )
      .max(100_000),
  }),
});

const yearSummaryExportSchema = z.object({
  vehicleName: z.string().trim().min(1).max(100),
  year: z.number().int().min(2000).max(2100),
  historyStartTime: z.number().finite().nonnegative().nullable(),
  format: z.enum(["csv", "json"]),
  months: z
    .array(
      z.object({
        summary: z.object({
          month: z.string().regex(/^\d{6}$/),
          historyStartTime: z.number().finite().nonnegative().nullable(),
          rideCount: z.number().int().nonnegative(),
          mileageKm: z.number().finite().nonnegative(),
          durationSeconds: z.number().finite().nonnegative(),
          energyWh: z.number().finite().nonnegative().nullable(),
          visibleRideCount: z.number().int().nonnegative(),
          aggregateAvailable: z.boolean(),
          ridesTruncated: z.boolean(),
          activeDayCount: z.number().int().min(0).max(31).nullable(),
          longestDayMileageKm: z.number().finite().nonnegative().nullable(),
        }),
        days: z
          .array(
            z.object({
              day: z.number().int().min(1).max(31),
              mileageKm: z.number().finite().nonnegative().nullable(),
            }),
          )
          .max(31),
      }),
    )
    .min(1)
    .max(12),
});

const monthSummaryExportSchema = z.object({
  vehicleName: z.string().trim().min(1).max(100),
  format: z.enum(["csv", "json"]),
  month: z.object({
    summary: z.object({
      month: z.string().regex(/^\d{6}$/),
      historyStartTime: z.number().finite().nonnegative().nullable(),
      rideCount: z.number().int().nonnegative(),
      mileageKm: z.number().finite().nonnegative(),
      durationSeconds: z.number().finite().nonnegative(),
      energyWh: z.number().finite().nonnegative().nullable(),
      visibleRideCount: z.number().int().min(0).max(20),
      aggregateAvailable: z.boolean(),
      ridesTruncated: z.boolean(),
      activeDayCount: z.number().int().min(0).max(31).nullable(),
      longestDayMileageKm: z.number().finite().nonnegative().nullable(),
    }),
    days: z
      .array(
        z.object({
          day: z.number().int().min(1).max(31),
          mileageKm: z.number().finite().nonnegative().nullable(),
        }),
      )
      .max(31),
    rides: z
      .array(
        z.object({
          id: z.string().regex(/^ride-\d+$/),
          startTime: z.number().finite().nonnegative(),
          endTime: z.number().finite().nonnegative(),
          mileageKm: z.number().finite().nonnegative(),
          durationSeconds: z.number().finite().nonnegative(),
          declaredMaxSpeed: z.number().finite().nonnegative().nullable(),
          energyWh: z.number().finite().nonnegative().nullable(),
          batteryUsedPercent: z.number().finite().nonnegative().nullable(),
          dayMileageKm: z.number().finite().nonnegative().nullable(),
        }),
      )
      .max(20)
      .refine((rides) => new Set(rides.map(({ id }) => id)).size === rides.length),
  }),
  speedVerifications: z
    .array(
      z.object({
        id: z.string().regex(/^ride-\d+$/),
        declaredMaxSpeed: z.number().finite().nonnegative().nullable(),
        sampledMaxSpeed: z.number().finite().nonnegative().nullable(),
      }),
    )
    .max(20)
    .refine(
      (verifications) => new Set(verifications.map(({ id }) => id)).size === verifications.length,
    ),
});

const exportDialogOptions = {
  gpx: { name: "GPX 轨迹", extensions: ["gpx"] },
  csv: { name: "CSV 表格", extensions: ["csv"] },
  json: { name: "JSON 数据", extensions: ["json"] },
} satisfies Record<RideExportFormat, FileFilter>;

const yearSummaryExportDialogOptions = {
  csv: { name: "CSV 表格", extensions: ["csv"] },
  json: { name: "JSON 数据", extensions: ["json"] },
} satisfies Record<YearSummaryExportFormat, FileFilter>;

const monthSummaryExportDialogOptions = {
  csv: { name: "CSV 表格", extensions: ["csv"] },
  json: { name: "JSON 数据", extensions: ["json"] },
} satisfies Record<MonthSummaryExportFormat, FileFilter>;

const snapshotCacheTtlMs = 15_000;
const rideMonthCacheTtlMs = 2 * 60_000;
const rideDetailCacheTtlMs = 10 * 60_000;

const ok = <T>(data: T): BridgeResult<T> => ({ ok: true, data });

const fail = <T>(error: BridgeError): BridgeResult<T> => ({ ok: false, error });

const handleError = <T>(error: unknown): BridgeResult<T> => {
  if (error instanceof z.ZodError) {
    return fail({ code: "INVALID_INPUT", message: "输入内容格式不正确。" });
  }
  if (error instanceof NineCliError) {
    const code =
      error.kind === "missing"
        ? "NINECLI_MISSING"
        : error.kind === "auth"
          ? "AUTH_REQUIRED"
          : error.kind === "verification"
            ? "HUMAN_VERIFICATION_REQUIRED"
            : error.kind === "integrity"
              ? "NINECLI_INTEGRITY"
              : error.kind === "unsupported"
                ? "UNSUPPORTED_PLATFORM"
                : "UPSTREAM_ERROR";
    return fail({ code, message: error.message });
  }
  return fail({ code: "UNKNOWN", message: "发生未知错误，请重新尝试。" });
};

/** Registers the complete renderer-facing domain bridge. */
export const registerIpcHandlers = (client: NineCliClient) => {
  const serialNumbers = new Map<string, string>();
  const travelIds = new Map<
    string,
    { serialNumber: string; travelId: string; dayMileageKm: number | null }
  >();
  const rideIdsByUpstream = new Map<string, string>();
  let rideSequence = 0;
  const snapshotCache = new SessionReadCache<VehicleSnapshot>();
  const rideMonthCache = new SessionReadCache<RideMonth>();
  const rideDetailCache = new SessionReadCache<RideDetail>();
  const readRideDetail = (
    vehicleId: string,
    rideId: string,
    serialNumber: string,
    travelId: string,
    dayMileageKm: number | null,
    refresh = false,
  ) =>
    rideDetailCache.read(
      `${vehicleId}\0${rideId}`,
      rideDetailCacheTtlMs,
      async () =>
        parseRideDetail(await client.rideDetail(serialNumber, travelId), rideId, dayMileageKm),
      refresh,
    );
  const clearReadCaches = () => {
    snapshotCache.clear();
    rideMonthCache.clear();
    rideDetailCache.clear();
  };

  ipcMain.handle(ipcChannels.authStatus, async (): Promise<BridgeResult<AuthStatus>> => {
    try {
      await client.whoami();
      return ok({ connected: true });
    } catch (error) {
      if (error instanceof NineCliError && error.kind === "auth") return ok({ connected: false });
      return handleError(error);
    }
  });

  ipcMain.handle(ipcChannels.authProfile, async (): Promise<BridgeResult<AccountProfile>> => {
    try {
      return ok(parseAccountProfile(await client.whoami()));
    } catch (error) {
      return handleError(error);
    }
  });

  ipcMain.handle(
    ipcChannels.passwordLogin,
    async (_event, input: unknown): Promise<BridgeResult<AuthStatus>> => {
      try {
        const { areaCode, user, password } = passwordLoginSchema.parse(input);
        await client.login(user, areaCode, password);
        return ok({ connected: true });
      } catch (error) {
        return handleError(error);
      }
    },
  );

  ipcMain.handle(
    ipcChannels.requestSmsCode,
    async (_event, input: unknown): Promise<BridgeResult<SmsCodeRequestStatus>> => {
      try {
        const { areaCode, phone } = smsCodeRequestSchema.parse(input);
        await client.requestSmsCode(phone, areaCode);
        return ok({ sent: true });
      } catch (error) {
        return handleError(error);
      }
    },
  );

  ipcMain.handle(
    ipcChannels.smsCodeLogin,
    async (_event, input: unknown): Promise<BridgeResult<AuthStatus>> => {
      try {
        const { areaCode, phone, code } = smsCodeLoginSchema.parse(input);
        await client.loginWithSmsCode(phone, areaCode, code);
        return ok({ connected: true });
      } catch (error) {
        return handleError(error);
      }
    },
  );

  ipcMain.handle(ipcChannels.authLogout, async (): Promise<BridgeResult<AuthStatus>> => {
    try {
      await client.logout();
      serialNumbers.clear();
      travelIds.clear();
      rideIdsByUpstream.clear();
      clearReadCaches();
      return ok({ connected: false });
    } catch (error) {
      return handleError(error);
    }
  });

  ipcMain.handle(
    ipcChannels.runtimeSecurity,
    async (): Promise<BridgeResult<RuntimeSecurityStatus>> => {
      try {
        return ok(await client.diagnostics());
      } catch (error) {
        return handleError(error);
      }
    },
  );

  ipcMain.handle(ipcChannels.listVehicles, async (): Promise<BridgeResult<VehicleSummary[]>> => {
    try {
      const vehicles = parseVehicles(await client.vehicles());
      serialNumbers.clear();
      travelIds.clear();
      rideIdsByUpstream.clear();
      clearReadCaches();
      const summaries = vehicles.map(({ serialNumber, ...vehicle }, index) => {
        const id = `vehicle-${index + 1}`;
        serialNumbers.set(id, serialNumber);
        return { id, ...vehicle };
      });
      return ok(summaries);
    } catch (error) {
      return handleError(error);
    }
  });

  ipcMain.handle(
    ipcChannels.getVehicleSnapshot,
    async (_event, input: unknown): Promise<BridgeResult<VehicleSnapshot>> => {
      try {
        const { vehicleId, refresh } = vehicleSnapshotSchema.parse(input);
        const serialNumber = serialNumbers.get(vehicleId);
        if (!serialNumber) {
          return fail({ code: "INVALID_INPUT", message: "车辆已失效，请刷新车辆列表。" });
        }
        return ok(
          await snapshotCache.read(
            vehicleId,
            snapshotCacheTtlMs,
            () => loadVehicleSnapshot(client, serialNumber),
            refresh,
          ),
        );
      } catch (error) {
        return handleError(error);
      }
    },
  );

  ipcMain.handle(
    ipcChannels.getVehicleLocation,
    async (_event, input: unknown): Promise<BridgeResult<VehicleLocationRead>> => {
      try {
        const { vehicleId } = vehicleLocationSchema.parse(input);
        const serialNumber = serialNumbers.get(vehicleId);
        if (!serialNumber) {
          return fail({ code: "INVALID_INPUT", message: "车辆已失效，请刷新车辆列表。" });
        }
        return ok(parseVehicleLocationRead(await client.vehicleStatus(serialNumber)));
      } catch (error) {
        return handleError(error);
      }
    },
  );

  ipcMain.handle(
    ipcChannels.listRides,
    async (_event, input: unknown): Promise<BridgeResult<RideMonth>> => {
      try {
        const { vehicleId, month, refresh } = rideListSchema.parse(input);
        const serialNumber = serialNumbers.get(vehicleId);
        if (!serialNumber)
          return fail({ code: "INVALID_INPUT", message: "车辆已失效，请刷新车辆列表。" });
        return ok(
          await rideMonthCache.read(
            `${vehicleId}\0${month}`,
            rideMonthCacheTtlMs,
            async () => {
              const parsedMonth = parseRideMonth(await client.rides(serialNumber, month), month);
              const summaries = parsedMonth.rides.map(({ travelId, ...ride }) => {
                const upstreamKey = `${serialNumber}\0${travelId}`;
                const existingId = rideIdsByUpstream.get(upstreamKey);
                const id = existingId ?? `ride-${++rideSequence}`;
                if (!existingId) rideIdsByUpstream.set(upstreamKey, id);
                // Re-establish the reverse mapping on every response. Concurrent refreshes can
                // otherwise retain an opaque id after a vehicle-list refresh cleared its target.
                travelIds.set(id, { serialNumber, travelId, dayMileageKm: ride.dayMileageKm });
                return { id, ...ride };
              });
              return { summary: parsedMonth.summary, days: parsedMonth.days, rides: summaries };
            },
            refresh,
          ),
        );
      } catch (error) {
        return handleError(error);
      }
    },
  );

  ipcMain.handle(
    ipcChannels.getRideDetail,
    async (_event, input: unknown): Promise<BridgeResult<RideDetail>> => {
      try {
        const { vehicleId, rideId, refresh } = rideDetailInputSchema.parse(input);
        const serialNumber = serialNumbers.get(vehicleId);
        const ride = travelIds.get(rideId);
        if (!serialNumber || !ride || ride.serialNumber !== serialNumber) {
          return fail({ code: "INVALID_INPUT", message: "行程已失效，请重新选择。" });
        }
        return ok(
          await readRideDetail(
            vehicleId,
            rideId,
            serialNumber,
            ride.travelId,
            ride.dayMileageKm,
            refresh,
          ),
        );
      } catch (error) {
        return handleError(error);
      }
    },
  );

  ipcMain.handle(
    ipcChannels.verifyRideSpeeds,
    async (_event, input: unknown): Promise<BridgeResult<RideSpeedVerificationResult>> => {
      try {
        const { vehicleId, rideIds } = rideSpeedVerificationSchema.parse(input);
        const serialNumber = serialNumbers.get(vehicleId);
        if (!serialNumber) {
          return fail({ code: "INVALID_INPUT", message: "车辆已失效，请刷新车辆列表。" });
        }
        const rides = rideIds.map((rideId) => ({ rideId, ride: travelIds.get(rideId) }));
        if (rides.some(({ ride }) => !ride || ride.serialNumber !== serialNumber)) {
          return fail({ code: "INVALID_INPUT", message: "行程已失效，请重新选择月份。" });
        }
        const batch = await loadRideSpeedVerifications(rideIds, async (rideId) => {
          const ride = travelIds.get(rideId);
          if (!ride || ride.serialNumber !== serialNumber) {
            throw new Error("Ride mapping changed during speed verification");
          }
          return readRideDetail(vehicleId, rideId, serialNumber, ride.travelId, ride.dayMileageKm);
        });
        const fatalFailure = batch.failures.find(
          ({ error }) => error instanceof NineCliError && error.kind !== "upstream",
        );
        if (fatalFailure) throw fatalFailure.error;
        if (batch.rides.length === 0 && batch.failures[0]) throw batch.failures[0].error;
        return ok({ rides: batch.rides, failedRideCount: batch.failures.length });
      } catch (error) {
        return handleError(error);
      }
    },
  );

  ipcMain.handle(
    ipcChannels.exportRide,
    async (event, input: unknown): Promise<BridgeResult<RideExportResult>> => {
      try {
        const { vehicleName, detail, format } = rideExportSchema.parse(input);
        const document = createRideExportDocument(vehicleName, detail, format);
        const options: SaveDialogOptions = {
          title: "导出骑行轨迹",
          defaultPath: document.fileName,
          filters: [exportDialogOptions[format]],
          properties: ["createDirectory", "showOverwriteConfirmation"],
        };
        const parentWindow = BrowserWindow.fromWebContents(event.sender);
        const selection = parentWindow
          ? await dialog.showSaveDialog(parentWindow, options)
          : await dialog.showSaveDialog(options);
        if (selection.canceled || !selection.filePath) return ok({ saved: false, fileName: null });
        await writeFile(selection.filePath, document.content, { encoding: "utf8", mode: 0o600 });
        return ok({ saved: true, fileName: basename(selection.filePath) });
      } catch (error) {
        return handleError(error);
      }
    },
  );

  ipcMain.handle(
    ipcChannels.exportMonthSummary,
    async (event, input: unknown): Promise<BridgeResult<RideExportResult>> => {
      try {
        const parsedInput = monthSummaryExportSchema.parse(input);
        const rideIds = new Set(parsedInput.month.rides.map(({ id }) => id));
        if (
          parsedInput.month.summary.visibleRideCount !== parsedInput.month.rides.length ||
          parsedInput.month.summary.rideCount < parsedInput.month.rides.length ||
          parsedInput.speedVerifications.some(({ id }) => !rideIds.has(id))
        ) {
          return fail({ code: "INVALID_INPUT", message: "月度清单已失效，请重新读取后导出。" });
        }
        const document = createMonthSummaryExportDocument(parsedInput);
        const options: SaveDialogOptions = {
          title: "导出月度行程清单",
          defaultPath: document.fileName,
          filters: [monthSummaryExportDialogOptions[document.format]],
          properties: ["createDirectory", "showOverwriteConfirmation"],
        };
        const parentWindow = BrowserWindow.fromWebContents(event.sender);
        const selection = parentWindow
          ? await dialog.showSaveDialog(parentWindow, options)
          : await dialog.showSaveDialog(options);
        if (selection.canceled || !selection.filePath) return ok({ saved: false, fileName: null });
        await writeFile(selection.filePath, document.content, { encoding: "utf8", mode: 0o600 });
        return ok({ saved: true, fileName: basename(selection.filePath) });
      } catch (error) {
        return handleError(error);
      }
    },
  );

  ipcMain.handle(
    ipcChannels.exportYearSummary,
    async (event, input: unknown): Promise<BridgeResult<RideExportResult>> => {
      try {
        const parsedInput = yearSummaryExportSchema.parse(input);
        const document = createYearSummaryExportDocument(parsedInput);
        const options: SaveDialogOptions = {
          title: "导出年度骑行摘要",
          defaultPath: document.fileName,
          filters: [yearSummaryExportDialogOptions[document.format]],
          properties: ["createDirectory", "showOverwriteConfirmation"],
        };
        const parentWindow = BrowserWindow.fromWebContents(event.sender);
        const selection = parentWindow
          ? await dialog.showSaveDialog(parentWindow, options)
          : await dialog.showSaveDialog(options);
        if (selection.canceled || !selection.filePath) return ok({ saved: false, fileName: null });
        await writeFile(selection.filePath, document.content, { encoding: "utf8", mode: 0o600 });
        return ok({ saved: true, fileName: basename(selection.filePath) });
      } catch (error) {
        return handleError(error);
      }
    },
  );
};
