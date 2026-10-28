import { writeFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  BrowserWindow,
  dialog,
  ipcMain,
  type FileFilter,
  type SaveDialogOptions,
  type WebContents,
} from "electron";
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
import {
  isNinebotHumanVerificationError,
  NinebotClientError,
  type NinebotAppClient,
} from "./app-client.js";
import { createMonthSummaryExportDocument } from "./month-summary-export.js";
import { createRideExportDocument } from "./ride-export.js";
import { loadRideSpeedVerifications } from "./ride-speed-verification.js";
import { createYearSummaryExportDocument } from "./year-summary-export.js";
import {
  emitRuntimeDiagnostic,
  type ReadOperation,
  type RuntimeDiagnosticObserver,
} from "./runtime-diagnostics.js";
import { SmsCodeFlow } from "./sms-verification.js";
import { presentSmsVerification } from "./sms-verification-window.js";
import { SessionReadCache } from "./session-read-cache.js";
import { loadVehicleSnapshot, type VehicleTelemetryReader } from "./vehicle-snapshot.js";
import { type TravelReader } from "./travel-source.js";
import { type VehicleReader } from "./vehicle-source.js";
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
  requestId: z.string().uuid().optional(),
  areaCode: z.string().regex(/^\d{1,4}$/),
  phone: z
    .string()
    .trim()
    .regex(/^\d{5,20}$/),
});

const smsCodeCancelSchema = z.object({ requestId: z.string().uuid() });

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
    .max(10_000)
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
      // The upstream endpoint is paginated in batches of 20, but a month may contain
      // many pages. Keep a generous safety bound while allowing the SDK to return all rows.
      visibleRideCount: z.number().int().min(0).max(10_000),
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
      .max(10_000)
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
    .max(10_000)
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
  if (isNinebotHumanVerificationError(error)) {
    return fail({
      code: "HUMAN_VERIFICATION_REQUIRED",
      message: "九号要求先完成人机验证；请在官方客户端完成验证后再重试。",
    });
  }
  if (error instanceof NinebotClientError) {
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
export const registerIpcHandlers = (
  client: NinebotAppClient,
  telemetryReader: VehicleTelemetryReader = client,
  travelReader: TravelReader = client,
  vehicleReader: VehicleReader = client,
  diagnostics: {
    onDiagnostic?: RuntimeDiagnosticObserver;
    now?: () => number;
    smsVerificationPresenter?: (owner: WebContents, signal: AbortSignal) => Promise<string | null>;
  } = {},
) => {
  const smsFlow = new SmsCodeFlow({
    requestCode: (phone, areaCode, validate, signal) =>
      client.requestSmsCode(phone, areaCode, validate, signal),
    canVerify: client.supportsSmsVerification === true,
  });
  const verificationOwners = new WeakSet<WebContents>();
  const presentVerification = diagnostics.smsVerificationPresenter ?? presentSmsVerification;
  const emit = (event: Parameters<RuntimeDiagnosticObserver>[0]) =>
    emitRuntimeDiagnostic(diagnostics.onDiagnostic, event);
  const handleRead = <T>(
    channel: string,
    operation: ReadOperation,
    handler: (...args: unknown[]) => Promise<BridgeResult<T>>,
  ) => {
    ipcMain.handle(channel, async (...args) => {
      emit({ category: "read", operation, outcome: "started" });
      try {
        const result = await handler(...args);
        emit({ category: "read", operation, outcome: result.ok ? "completed" : "failed" });
        return result;
      } catch (error) {
        emit({ category: "read", operation, outcome: "failed" });
        throw error;
      }
    });
  };
  const serialNumbers = new Map<string, string>();
  const travelIds = new Map<
    string,
    { serialNumber: string; travelId: string; dayMileageKm: number | null }
  >();
  const rideIdsByUpstream = new Map<string, string>();
  let rideSequence = 0;
  const snapshotCache = new SessionReadCache<VehicleSnapshot>(diagnostics.now, (outcome) =>
    emit({ category: "cache", operation: "snapshot", outcome }),
  );
  const rideMonthCache = new SessionReadCache<RideMonth>(diagnostics.now, (outcome) =>
    emit({ category: "cache", operation: "ride-month", outcome }),
  );
  const rideDetailCache = new SessionReadCache<RideDetail>(diagnostics.now, (outcome) =>
    emit({ category: "cache", operation: "ride-detail", outcome }),
  );
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
        parseRideDetail(
          await travelReader.rideDetail(serialNumber, travelId),
          rideId,
          dayMileageKm,
        ),
      refresh,
    );
  const clearReadCaches = () => {
    snapshotCache.clear();
    rideMonthCache.clear();
    rideDetailCache.clear();
  };
  const clearSessionState = (resetRideSequence = false) => {
    telemetryReader.clear?.();
    travelReader.clear?.();
    vehicleReader.clear?.();
    serialNumbers.clear();
    travelIds.clear();
    rideIdsByUpstream.clear();
    clearReadCaches();
    if (resetRideSequence) rideSequence = 0;
  };

  const handleSessionReadError = <T>(error: unknown): BridgeResult<T> => {
    const result = handleError<T>(error);
    if (!result.ok && result.error.code === "AUTH_REQUIRED") clearSessionState(true);
    return result;
  };

  ipcMain.handle(ipcChannels.authStatus, async (): Promise<BridgeResult<AuthStatus>> => {
    try {
      await client.whoami();
      return ok({ connected: true });
    } catch (error) {
      if (error instanceof NinebotClientError && error.kind === "auth") {
        clearSessionState(true);
        return ok({ connected: false });
      }
      return handleError(error);
    }
  });

  ipcMain.handle(ipcChannels.authProfile, async (): Promise<BridgeResult<AccountProfile>> => {
    try {
      return ok(parseAccountProfile(await client.whoami()));
    } catch (error) {
      return handleSessionReadError(error);
    }
  });

  ipcMain.handle(
    ipcChannels.passwordLogin,
    async (_event, input: unknown): Promise<BridgeResult<AuthStatus>> => {
      try {
        const { areaCode, user, password } = passwordLoginSchema.parse(input);
        smsFlow.cancelAll();
        await client.login(user, areaCode, password);
        clearSessionState(true);
        return ok({ connected: true });
      } catch (error) {
        return handleError(error);
      }
    },
  );

  ipcMain.handle(
    ipcChannels.requestSmsCode,
    async (event, input: unknown): Promise<BridgeResult<SmsCodeRequestStatus>> => {
      try {
        const { phone, areaCode, requestId } = smsCodeRequestSchema.parse(input);
        const request = { phone, areaCode, ...(requestId === undefined ? {} : { requestId }) };
        const owner = event.sender;
        const ownerId = owner.id;
        if (!verificationOwners.has(owner)) {
          verificationOwners.add(owner);
          owner.once("destroyed", () => smsFlow.cancel(ownerId));
          owner.on("render-process-gone", () => smsFlow.cancel(ownerId));
          owner.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
            if (isMainFrame && !isInPlace) smsFlow.cancel(ownerId);
          });
        }
        return ok(
          await smsFlow.request(ownerId, request, (signal) => presentVerification(owner, signal)),
        );
      } catch (error) {
        return handleError(error);
      }
    },
  );

  ipcMain.handle(
    ipcChannels.cancelSmsCode,
    async (event, input: unknown): Promise<BridgeResult<{ cancelled: true }>> => {
      try {
        const { requestId } = smsCodeCancelSchema.parse(input);
        smsFlow.cancel(event.sender.id, requestId);
        return ok({ cancelled: true });
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
        smsFlow.cancelAll();
        await client.loginWithSmsCode(phone, areaCode, code);
        clearSessionState(true);
        return ok({ connected: true });
      } catch (error) {
        return handleError(error);
      }
    },
  );

  ipcMain.handle(ipcChannels.authLogout, async (): Promise<BridgeResult<AuthStatus>> => {
    try {
      smsFlow.cancelAll();
      await client.logout();
      clearSessionState(true);
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

  handleRead(
    ipcChannels.listVehicles,
    "vehicles",
    async (): Promise<BridgeResult<VehicleSummary[]>> => {
      try {
        const vehicles = parseVehicles(await vehicleReader.vehicles());
        clearSessionState();
        const summaries = vehicles.map(({ serialNumber, ...vehicle }, index) => {
          const id = `vehicle-${index + 1}`;
          serialNumbers.set(id, serialNumber);
          return { id, ...vehicle };
        });
        return ok(summaries);
      } catch (error) {
        return handleSessionReadError(error);
      }
    },
  );

  handleRead(
    ipcChannels.getVehicleSnapshot,
    "snapshot",
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
            () => loadVehicleSnapshot(telemetryReader, serialNumber),
            refresh,
          ),
        );
      } catch (error) {
        return handleSessionReadError(error);
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
        return ok(parseVehicleLocationRead(await telemetryReader.vehicleStatus(serialNumber)));
      } catch (error) {
        return handleSessionReadError(error);
      }
    },
  );

  handleRead(
    ipcChannels.listRides,
    "ride-month",
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
              const parsedMonth = parseRideMonth(
                await travelReader.rides(serialNumber, month),
                month,
              );
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
        return handleSessionReadError(error);
      }
    },
  );

  handleRead(
    ipcChannels.getRideDetail,
    "ride-detail",
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
        return handleSessionReadError(error);
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
          ({ error }) => error instanceof NinebotClientError && error.kind !== "upstream",
        );
        if (fatalFailure) throw fatalFailure.error;
        if (batch.rides.length === 0 && batch.failures[0]) throw batch.failures[0].error;
        return ok({ rides: batch.rides, failedRideCount: batch.failures.length });
      } catch (error) {
        return handleSessionReadError(error);
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
        return handleSessionReadError(error);
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
        return handleSessionReadError(error);
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
        return handleSessionReadError(error);
      }
    },
  );
};
