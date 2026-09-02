import { join } from "node:path";
import { app, BrowserWindow, dialog, Menu, protocol, session, shell } from "electron";
import {
  appProtocolEntryUrl,
  appProtocolRecoveryUrl,
  appProtocolScheme,
  registerAppProtocol,
} from "./app-protocol.js";
import { registerIpcHandlers } from "./ipc.js";
import { getBundledNineCliBinaryPath, NineCliClient } from "./ninecli.js";

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
  const configDirectory =
    process.env.NINEBOT_CONFIG_DIR ?? join(app.getPath("userData"), "ninecli");
  const bundledBinaryPath = getBundledNineCliBinaryPath({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
  registerIpcHandlers(new NineCliClient(configDirectory, bundledBinaryPath));
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
