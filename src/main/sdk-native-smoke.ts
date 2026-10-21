import { createNinebotPassportLoginClient } from "@jiuhao/ninebot-client";
import { classifyProfileFailure, type ProfileFailure } from "./sdk-profile-failure.js";
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { app, ipcMain, session } from "electron";
import { sdkSmokeChannels } from "../shared/sdk-native-smoke.js";

export const assertSmokeDirectories = (root: string, userData: string, config: string) => {
  if (
    !basename(root).startsWith("ninebot-sdk-native-smoke-") ||
    resolve(userData) !== join(resolve(root), "user-data") ||
    resolve(config) !== join(resolve(root), "config")
  )
    throw new Error("Native smoke requires its own isolated directories");
};
export const pickSmokeFlags = (value: unknown) => {
  const row = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    rendererMounted: row.rendererMounted === true,
    sdkIdentity: row.sdkIdentity === true,
    bridgeRoundTrip: row.bridgeRoundTrip === true,
    unauthenticated: row.unauthenticated === true,
  };
};

/** Explicit offline acceptance only. Reports booleans/events, never DOM, pixels or credentials. */
export const configureSdkNativeSmoke = () => {
  const root = process.env.NINEBOT_SDK_OFFLINE_SMOKE_ROOT;
  const enabled = typeof root === "string" && root.length > 0;
  ipcMain.handle(sdkSmokeChannels.configure, () => enabled);
  if (!root) return;
  const config = process.env.NINEBOT_CONFIG_DIR ?? "";
  assertSmokeDirectories(root, app.getPath("userData"), config);
  if (
    readFileSync(join(root, "offline-smoke.marker"), "utf8") !== "sdk-only-offline-v1" ||
    readdirSync(config).length !== 0 ||
    existsSync(join(config, "auth-session.json"))
  )
    throw new Error("Native smoke requires a fresh empty config and explicit marker");
  if (!app.commandLine.hasSwitch("use-mock-keychain"))
    throw new Error("Native smoke must use a mock keychain");
  const path = join(root, "native-smoke-report.json");
  const state = {
    version: 1,
    originalFetchAvailable: typeof globalThis.fetch === "function",
    originalWebCryptoAvailable: Boolean(globalThis.crypto?.subtle),
    syntheticProfileCompleted: false,
    syntheticProfileFailure: null as ProfileFailure | null,
    pid: process.pid,
    nativeWindowCreated: false,
    localPageLoaded: false,
    rendererMounted: false,
    sdkIdentity: false,
    bridgeRoundTrip: false,
    unauthenticated: false,
    nodeNetworkAttempts: 0,
    chromiumRequestsBlocked: 0,
    preloadFailures: 0,
    loadFailures: 0,
    renderProcessGone: false,
    mockKeychain: true,
    isolatedDirectories: true,
    electronProcessTypes: [] as string[],
    completed: false,
  };
  const record = () => {
    state.completed =
      state.originalFetchAvailable &&
      state.syntheticProfileCompleted &&
      state.nativeWindowCreated &&
      state.localPageLoaded &&
      state.rendererMounted &&
      state.sdkIdentity &&
      state.bridgeRoundTrip &&
      state.unauthenticated &&
      state.preloadFailures === 0 &&
      state.loadFailures === 0 &&
      !state.renderProcessGone &&
      state.nodeNetworkAttempts === 0;
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
    renameSync(temporary, path);
  };
  globalThis.fetch = async () => {
    state.nodeNetworkAttempts += 1;
    record();
    throw new Error("Offline native smoke blocks network");
  };
  app.whenReady().then(async () => {
    // Exercise the real portable Passport signer with synthetic material and no network.
    try {
      const client = createNinebotPassportLoginClient({
        transport: {
          send: async () => ({
            status: 200,
            headers: {},
            body: new TextEncoder().encode(JSON.stringify({ resultCode: 90000, data: {} })),
          }),
        },
      });
      await client.whoami({ accessToken: "synthetic-offline-only" });
      state.syntheticProfileCompleted = true;
    } catch (error) {
      state.syntheticProfileFailure = classifyProfileFailure(error);
    }
    record();
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
      (_details, callback) => {
        state.chromiumRequestsBlocked += 1;
        record();
        callback({ cancel: true });
      },
    );
  });
  app.on("browser-window-created", (_event, window) => {
    state.nativeWindowCreated = true;
    record();
    window.webContents.on("did-finish-load", () => {
      state.localPageLoaded = window.webContents.getURL() === "ninebot-desktop://app/index.html";
      record();
    });
    window.webContents.on("preload-error", () => {
      state.preloadFailures += 1;
      record();
    });
    window.webContents.on("did-fail-load", (_loadEvent, code, _description, _url, main) => {
      if (main && code !== -3) {
        state.loadFailures += 1;
        record();
      }
    });
    window.webContents.on("render-process-gone", () => {
      state.renderProcessGone = true;
      record();
    });
  });
  ipcMain.on(sdkSmokeChannels.report, (event, value: unknown) => {
    if (event.sender.getURL() !== "ninebot-desktop://app/index.html" || event.senderFrame?.parent)
      return;
    Object.assign(state, pickSmokeFlags(value));
    state.electronProcessTypes = app
      .getAppMetrics()
      .map((metric) => metric.type)
      .toSorted();
    record();
  });
  record();
};
