import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { BrowserWindow, ipcMain, session, type IpcMainEvent, type WebContents } from "electron";
import { appProtocolScheme } from "./renderer-path.js";
import { NinebotClientError } from "./app-client.js";
import {
  createSmsVerificationPage,
  isSmsVerificationResource,
  smsVerificationCsp,
} from "./sms-verification-page.js";

const denyDownload = (event: Electron.Event) => event.preventDefault();

const resultChannel = "ninebot:sms-verification:result";
const pageUrl = `${appProtocolScheme}://sms-verification/index.html`;

/** Shows only the provider UI, with a one-result preload and an ephemeral session. */
export const presentSmsVerification = (
  owner: WebContents,
  signal: AbortSignal,
): Promise<string | null> => {
  if (signal.aborted || owner.isDestroyed()) return Promise.resolve(null);
  const parent = BrowserWindow.fromWebContents(owner);
  if (!parent)
    return Promise.reject(
      new NinebotClientError("无法打开验证窗口，请重新打开登录界面。", "verification"),
    );
  const nonce = randomUUID();
  const isolatedSession = session.fromPartition(`sms-verification-${nonce}`, { cache: false });
  isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.protocol.handle(appProtocolScheme, (request) =>
    request.url === pageUrl && request.method === "GET"
      ? new Response(createSmsVerificationPage(nonce), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": smsVerificationCsp(nonce),
            "Cache-Control": "no-store",
          },
        })
      : new Response("Not found", { status: 404 }),
  );
  isolatedSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: details.url !== pageUrl && !isSmsVerificationResource(details.url) });
  });
  isolatedSession.on("will-download", denyDownload);
  const window = new BrowserWindow({
    parent,
    modal: true,
    width: 470,
    height: 650,
    resizable: false,
    show: false,
    title: "短信登录验证",
    backgroundColor: "#f5f7f8",
    autoHideMenuBar: true,
    webPreferences: {
      session: isolatedSession,
      preload: join(import.meta.dirname, "../preload/sms-verification.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      devTools: false,
      zoomFactor: 1,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-frame-navigate", (event) => event.preventDefault());
  window.webContents.on("will-redirect", (event) => event.preventDefault());

  return new Promise<string | null>((resolve, reject) => {
    let settled = false;
    const finish = (validate: string | null, message?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      owner.removeListener("destroyed", cancel);
      ipcMain.removeListener(resultChannel, receive);
      if (!window.isDestroyed()) window.destroy();
      isolatedSession.protocol.unhandle(appProtocolScheme);
      isolatedSession.webRequest.onBeforeRequest(null);
      isolatedSession.removeListener("will-download", denyDownload);
      isolatedSession.setPermissionRequestHandler(null);
      isolatedSession.setPermissionCheckHandler(null);
      // The session is in-memory; erase provider storage when the interaction ends.
      void isolatedSession.clearStorageData().catch(() => {});
      void isolatedSession.closeAllConnections().catch(() => {});
      if (message) reject(new NinebotClientError(message, "verification"));
      else resolve(validate);
    };
    const cancel = () => finish(null);
    const receive = (event: IpcMainEvent, result: unknown) => {
      if (settled || window.isDestroyed() || signal.aborted || owner.isDestroyed()) return;
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame.url !== pageUrl
      )
        return;
      if (!result || typeof result !== "object") return;
      const value = result as { type?: unknown; validate?: unknown };
      if (value.type === "cancel") cancel();
      else if (value.type === "failed")
        finish(null, "验证组件加载失败，请检查网络后重新发送验证码。");
      else if (
        value.type === "complete" &&
        typeof value.validate === "string" &&
        value.validate.trim() &&
        value.validate.length <= 4096
      )
        finish(value.validate);
    };
    const timer = setTimeout(() => finish(null, "验证已超时，请重新发送验证码。"), 180_000);
    signal.addEventListener("abort", cancel, { once: true });
    owner.once("destroyed", cancel);
    ipcMain.on(resultChannel, receive);
    window.once("closed", cancel);
    window.webContents.once("preload-error", () =>
      finish(null, "验证窗口初始化失败，请重新构建或安装应用。"),
    );
    window.webContents.once("render-process-gone", () =>
      finish(null, "验证窗口已中断，请重新发送验证码。"),
    );
    window.once("ready-to-show", () => {
      if (!settled) window.show();
    });
    void window.loadURL(pageUrl).catch(() => finish(null, "验证窗口加载失败，请重新发送验证码。"));
  });
};
