/** Isolated QA entry, never imported by the product. Every provider and domain is synthetic. */
import { app, BrowserWindow, protocol, session } from "electron";
import { join } from "node:path";
import {
  NinebotAuthSessionManager,
  createFileNinebotAuthSessionStore,
  PassportLoginBusinessError,
} from "@jiuhao/ninebot-client";
import { normalizeSdkAuthError } from "../../src/main/sdk-app-client.js";
import { registerIpcHandlers } from "../../src/main/ipc.js";
import { createSdkDesktopRuntime } from "../../src/main/sdk-desktop-runtime.js";
import {
  registerAppProtocol,
  appProtocolEntryUrl,
  appProtocolScheme,
} from "../../src/main/app-protocol.js";

const root = process.env.NINEBOT_AUTH_QA_ROOT;
const project = process.env.NINEBOT_AUTH_QA_PROJECT;
if (!root || !project) throw new Error("Isolated QA paths required");
app.setPath("userData", join(root, "user-data"));
protocol.registerSchemesAsPrivileged([
  {
    scheme: appProtocolScheme,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
  },
]);
let now = Date.now();
let rejectRefresh = false;
let vehiclePresent = true;
let refreshes = 0;
let networkAttempts = 0;
globalThis.fetch = async () => {
  networkAttempts += 1;
  throw new Error("QA network blocked");
};
const fresh = () => ({
  accessToken: "qa-access",
  refreshToken: "qa-refresh",
  uuid: "qa-uuid",
  businessUid: "qa-business",
  expiresAtMs: now + 3_600_000,
});
const auth = new NinebotAuthSessionManager({
  store: createFileNinebotAuthSessionStore({
    directory: join(root, "session"),
    legacyFileName: false,
  }),
  now: () => now,
  provider: {
    loginWithPassword: async ({ user, password }) => {
      if (user !== "qa-user" || password !== "qa-password")
        throw new PassportLoginBusinessError(90016, "synthetic only");
      return fresh();
    },
    requestSmsCode: async () => {
      throw new Error("SMS disabled in QA");
    },
    loginWithSmsCode: async () => {
      throw new Error("SMS disabled in QA");
    },
    refresh: async () => {
      refreshes += 1;
      if (rejectRefresh) throw new PassportLoginBusinessError(90016, "synthetic only");
      return fresh();
    },
    whoami: async <T>() => ({ username: "qa-user", hasPassword: true }) as T,
  },
});
const ensure = async () => {
  try {
    await auth.ensureSession();
  } catch (error) {
    throw normalizeSdkAuthError(error);
  }
};
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (_details, callback) => {
      networkAttempts += 1;
      callback({ cancel: true });
    },
  );
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  registerAppProtocol(join(project, "out/renderer"));
  const client = await createSdkDesktopRuntime({
    configDirectory: join(root, "session"),
    auth,
    readers: {
      vehicleReader: {
        vehicles: async () => {
          await ensure();
          return vehiclePresent
            ? [{ wnumber: "qa-serial", device_name: "离线验收车辆", vehicle_name: "QA" }]
            : [];
        },
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
          return { count: 0, totalMileage: 0, totalTime: 0, list: [] };
        },
        rideDetail: async () => {
          throw new Error("No synthetic rides");
        },
      },
    },
  });
  registerIpcHandlers(client);
  Reflect.set(globalThis, "ninebotAuthQa", (command: string) => {
    if (command === "expire") now += 3_600_001;
    if (command === "reject-refresh") {
      now += 3_600_001;
      rejectRefresh = true;
    }
    if (command === "allow-login") rejectRefresh = false;
    if (command === "empty-vehicles") vehiclePresent = false;
    return { refreshes, networkAttempts };
  });
  const window = new BrowserWindow({
    width: 1280,
    height: 850,
    webPreferences: {
      preload: join(project, "out/preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadURL(appProtocolEntryUrl);
});
app.on("window-all-closed", () => app.quit());
