import { app, BrowserWindow, protocol, session } from "electron";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  registerAppProtocol,
  appProtocolEntryUrl,
  appProtocolScheme,
} from "../../src/main/app-protocol.js";

const root = process.env.NINEBOT_MAP_QA_ROOT;
const project = process.env.NINEBOT_MAP_QA_PROJECT;
if (!root || !project) throw new Error("Isolated map QA paths required");
const require = createRequire(import.meta.url);
const { allowRendererHttpRequest, mapResourceKind } = require(
  join(project, "scripts/sdk-desktop-acceptance.cjs"),
) as {
  allowRendererHttpRequest: (url: string) => boolean;
  mapResourceKind: (url: string) => string | null;
};
const blockMaps = process.env.NINEBOT_MAP_QA_BLOCK_MAPS === "1";
const counts: Record<string, number> = {};
const diagnostics = { blocked: 0, counts, failures: 0 };
Object.assign(globalThis, { mapQaDiagnostics: () => diagnostics });
app.setPath("userData", join(root, blockMaps ? "blocked-user-data" : "fixed-user-data"));
protocol.registerSchemesAsPrivileged([
  {
    scheme: appProtocolScheme,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
  },
]);
app.whenReady().then(async () => {
  const requests = session.defaultSession.webRequest;
  const filter = { urls: ["http://*/*", "https://*/*"] };
  requests.onBeforeRequest(filter, (details, callback) => {
    const cancel = blockMaps || !allowRendererHttpRequest(details.url);
    if (cancel) diagnostics.blocked += 1;
    callback({ cancel });
  });
  requests.onCompleted(filter, (details) => {
    const kind = mapResourceKind(details.url);
    if (kind && details.statusCode >= 200 && details.statusCode < 300)
      counts[kind] = (counts[kind] ?? 0) + 1;
  });
  requests.onErrorOccurred(filter, () => {
    diagnostics.failures += 1;
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  registerAppProtocol(join(root, "renderer"));
  const window = new BrowserWindow({
    width: 1000,
    height: 1000,
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  await window.loadURL(appProtocolEntryUrl);
});
app.on("window-all-closed", () => app.quit());
