import { access } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, dialog, Menu, protocol, session, shell } from "electron";
import {
  appProtocolEntryUrl,
  appProtocolRecoveryUrl,
  appProtocolScheme,
  registerAppProtocol,
} from "./app-protocol.js";
import {
  createFileNinebotAuthSessionStore,
  createFetchNinebotTransport,
  createNinebotPassportAuthProvider,
  createNinebotPassportLoginClient,
  NinebotAuthSessionManager,
  defaultNinebotServiceEndpoints,
} from "@jiuhao/ninebot-client";
import { decodeGzipBody } from "@jiuhao/ninebot-client/response-node";
import { registerIpcHandlers } from "./ipc.js";
import type { NinebotAppClient } from "./app-client.js";
import { candidateRequestTimeoutMs } from "./candidate-client.js";
import { getBundledNineCliBinaryPath, NineCliClient } from "./ninecli.js";
import { createNinebotSdkAppClient } from "./sdk-app-client.js";
import { createSdkRuntimeDiagnostics } from "./sdk-runtime.js";
import { createCandidateTelemetryReader } from "./telemetry-source.js";
import { createCandidateTravelReader } from "./travel-source.js";
import { createCandidateVehicleReader } from "./vehicle-source.js";
import { isCandidateSourceEnabled } from "./data-source.js";
import { resolveNinebotConfigDirectory } from "./config-directory.js";

protocol.registerSchemesAsPrivileged([
  {
    scheme: appProtocolScheme,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
  },
]);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let mainWindow: BrowserWindow | null = null;
let unresponsivePromptOpen = false;

/** Resolves the authentication implementation; legacy is an explicit recovery switch. */
export const resolveAuthSource = (environment: Readonly<Record<string, string | undefined>>) =>
  environment.NINEBOT_AUTH_SOURCE === "legacy" ? "legacy" : "sdk";

const loadRecoveryPage = async (reason: string) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.getURL().startsWith(appProtocolRecoveryUrl)) return;
  try {
    await mainWindow.loadURL(`${appProtocolRecoveryUrl}?reason=${encodeURIComponent(reason)}`);
  } catch (error) {
    console.error("Unable to load the local recovery page", error);
  }
};

const createWindow = async () => {
  const macWindowOptions =
    process.platform === "darwin"
      ? ({ titleBarStyle: "hiddenInset", trafficLightPosition: { x: 18, y: 18 } } as const)
      : {};
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: "#edf1f5",
    title: "韭号出行",
    ...macWindowOptions,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`${appProtocolScheme}://app/`)) event.preventDefault();
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, _errorDescription, validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 || validatedUrl.startsWith(appProtocolRecoveryUrl))
        return;
      void loadRecoveryPage(`load-${errorCode}`);
    },
  );
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit") void loadRecoveryPage(`renderer-${details.reason}`);
  });
  mainWindow.webContents.on("unresponsive", () => {
    if (!mainWindow || unresponsivePromptOpen) return;
    unresponsivePromptOpen = true;
    void dialog
      .showMessageBox(mainWindow, {
        type: "warning",
        title: "韭号出行暂时没有响应",
        message: "页面暂时没有响应。要重新加载本地界面吗？",
        buttons: ["重新加载", "继续等待"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0 && mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.reload();
      })
      .finally(() => {
        unresponsivePromptOpen = false;
      });
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) await mainWindow.loadURL(rendererUrl);
  else await mainWindow.loadURL(appProtocolEntryUrl);
};

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  registerAppProtocol(join(import.meta.dirname, "../renderer"));
  const userDataDirectory = app.getPath("userData");
  const sdkDirectory = join(userDataDirectory, "ninebot");
  const legacyDirectory = join(userDataDirectory, "ninecli");
  const [sdkDirectoryExists, legacyDirectoryExists] = await Promise.all([
    access(sdkDirectory).then(
      () => true,
      () => false,
    ),
    access(legacyDirectory).then(
      () => true,
      () => false,
    ),
  ]);
  const configDirectory = resolveNinebotConfigDirectory({
    explicitDirectory: process.env.NINEBOT_CONFIG_DIR,
    userDataDirectory,
    sdkDirectoryExists,
    legacyDirectoryExists,
  });
  let appClient: NinebotAppClient;
  // The pure TypeScript Passport/session client is the default. The legacy
  // process boundary remains an explicit recovery switch during migration.
  const useSdkAuth = resolveAuthSource(process.env) === "sdk";
  if (useSdkAuth) {
    const passportOrigin =
      process.env.NINEBOT_PASSPORT_ORIGIN ??
      defaultNinebotServiceEndpoints.find(({ service }) => service === "passport")?.upstreamOrigin;
    if (!passportOrigin) throw new Error("Ninebot Passport origin is unavailable");
    const transport = createFetchNinebotTransport({
      origins: { passport: passportOrigin },
      timeoutMs: candidateRequestTimeoutMs,
    });
    const passportClient = createNinebotPassportLoginClient({
      transport,
      responseBodyDecoder: (response) => decodeGzipBody(response),
    });
    const auth = new NinebotAuthSessionManager({
      provider: createNinebotPassportAuthProvider(passportClient),
      store: createFileNinebotAuthSessionStore({ directory: configDirectory }),
    });
    await auth.restore();
    const telemetryReader = createCandidateTelemetryReader({ configDirectory });
    const travelReader = createCandidateTravelReader({ configDirectory });
    const vehicleReader = createCandidateVehicleReader({ configDirectory });
    appClient = createNinebotSdkAppClient({
      auth,
      diagnostics: createSdkRuntimeDiagnostics({ configDirectory, auth }),
      telemetryReader,
      travelReader,
      vehicleReader,
    });
  } else {
    const bundledBinaryPath = getBundledNineCliBinaryPath({
      appPath: app.getAppPath(),
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
    });
    const nineCliClient = new NineCliClient(configDirectory, bundledBinaryPath);
    const telemetryReader = isCandidateSourceEnabled(process.env, "telemetry")
      ? createCandidateTelemetryReader({ configDirectory })
      : nineCliClient;
    const travelReader = isCandidateSourceEnabled(process.env, "travel")
      ? createCandidateTravelReader({ configDirectory })
      : nineCliClient;
    const vehicleReader = isCandidateSourceEnabled(process.env, "vehicle")
      ? createCandidateVehicleReader({ configDirectory })
      : nineCliClient;
    appClient = nineCliClient;
    registerIpcHandlers(appClient, telemetryReader, travelReader, vehicleReader);
  }
  if (useSdkAuth) registerIpcHandlers(appClient);
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
