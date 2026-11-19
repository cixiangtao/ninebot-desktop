/** Synthetic multi-account desktop; all data/providers are local and network is blocked. */
import { app, BrowserWindow, protocol, session } from "electron";
import { join } from "node:path";
import {
  createFileNinebotAuthSessionStore,
  PassportLoginBusinessError,
  NinebotAuthSessionManager,
} from "@jiuhao/ninebot-client/node";
import { createMultiAccountRuntime } from "../../src/main/account-runtime.js";
import { createSingleSdkDesktopRuntime } from "../../src/main/sdk-desktop-runtime.js";
import { normalizeSdkAuthError } from "../../src/main/sdk-app-client.js";
import { registerIpcHandlers } from "../../src/main/ipc.js";
import {
  appProtocolScheme,
  appProtocolEntryUrl,
  registerAppProtocol,
} from "../../src/main/app-protocol.js";

const root = process.env.NINEBOT_ACCOUNTS_QA_ROOT;
const project = process.env.NINEBOT_ACCOUNTS_QA_PROJECT;
if (!root || !project) throw new Error("QA paths required");
app.setPath("userData", join(root, "user-data"));
protocol.registerSchemesAsPrivileged([
  {
    scheme: appProtocolScheme,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let expiredUid: string | null = null;
let logins = 0;
let network = 0;
globalThis.fetch = async () => {
  network += 1;
  throw new Error("QA network blocked");
};
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (_details, callback) => {
      network += 1;
      callback({ cancel: true });
    },
  );
  registerAppProtocol(join(project, "out/renderer"));
  const client = await createMultiAccountRuntime({
    directory: join(root, "session"),
    createRuntime: async (configDirectory) => {
      const auth = new NinebotAuthSessionManager({
        store: createFileNinebotAuthSessionStore({
          directory: configDirectory,
          legacyFileName: false,
        }),
        provider: {
          loginWithPassword: async ({ user, password }) => {
            if (!["qa-a", "qa-b"].includes(user) || password !== "qa-password")
              throw new Error("Synthetic credentials rejected");
            logins += 1;
            return {
              accessToken: `qa-token-${user}`,
              refreshToken: `qa-refresh-${user}`,
              businessUid: user,
              uuid: user,
            };
          },
          requestSmsCode: async () => {},
          loginWithSmsCode: async () => {
            throw new Error("QA uses password");
          },
          whoami: async <T>(value: { businessUid: string }) => {
            if (expiredUid === value.businessUid)
              throw new PassportLoginBusinessError(90016, "synthetic expired");
            return { username: value.businessUid, hasPassword: true } as T;
          },
        },
      });
      const ensure = async () => {
        try {
          return await auth.ensureSession();
        } catch (error) {
          throw normalizeSdkAuthError(error);
        }
      };
      return createSingleSdkDesktopRuntime({
        configDirectory,
        auth,
        readers: {
          vehicleReader: {
            vehicles: async () => [
              {
                wnumber: `SN-${(await ensure()).businessUid}`,
                device_name:
                  (await ensure()).businessUid === "qa-a" ? "账号 A 的车辆" : "账号 B 的车辆",
                vehicle_name: "离线验收",
              },
            ],
          },
          telemetryReader: {
            vehicleStatus: async () => {
              await ensure();
              return {};
            },
            battery: async () => {
              await ensure();
              return {};
            },
          },
          travelReader: {
            rides: async () => {
              await ensure();
              return { count: 0, list: [] };
            },
            rideDetail: async () => {
              throw new Error("No synthetic rides");
            },
          },
        },
      });
    },
  });
  registerIpcHandlers(client);
  Reflect.set(globalThis, "accountsQa", (command?: string) => {
    if (command === "expire-b") expiredUid = "qa-b";
    return { logins, network };
  });
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    webPreferences: {
      preload: join(project, "out/preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadURL(appProtocolEntryUrl);
});
