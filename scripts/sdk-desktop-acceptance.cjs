// Opt-in acceptance entry only; normal product startup does not import this file.
const { readFileSync, writeFileSync, renameSync, statSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const mapOrigin = "https://tiles.openfreemap.org";

const allowRendererHttpRequest = (input) => {
  try {
    const url = new URL(input);
    return url.origin === mapOrigin && url.username === "" && url.password === "";
  } catch {
    return false;
  }
};

// Fixed categories only: paths, tile coordinates, queries and response bodies are never recorded.
const mapResourceKind = (input) => {
  if (!allowRendererHttpRequest(input)) return null;
  const { pathname } = new URL(input);
  if (pathname.startsWith("/styles/")) return "style";
  if (pathname.startsWith("/fonts/")) return "glyph";
  if (pathname.startsWith("/sprites/")) return "sprite";
  if (pathname === "/planet") return "source";
  if (pathname.startsWith("/planet/")) return "vectorTile";
  if (pathname.startsWith("/natural_earth/")) return "rasterTile";
  return "otherMapResource";
};

const launch = ({ root, project = resolve(__dirname, "..") }) => {
  const { app, session } = require("electron");
  root = resolve(root);
  project = resolve(project);
  const statePath = join(root, "acceptance-state.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const userData = join(root, "user-data");
  const config = join(root, "sdk-session");
  if (
    state.sdkConfigDirectory !== config ||
    !statSync(userData).isDirectory() ||
    !statSync(config).isDirectory()
  ) {
    throw new Error("Existing isolated acceptance directories required");
  }
  const label = "韭号出行 · SDK 独立验收";
  process.env.NINEBOT_AUTH_SOURCE = "sdk";
  process.env.NINEBOT_CONFIG_DIR = config;
  process.env.NINEBOT_RUNTIME_DIAGNOSTICS = "1";
  delete process.env.ELECTRON_RENDERER_URL;
  app.setPath("userData", userData);
  if (app.getPath("userData") !== userData) throw new Error("Isolated user data required");
  const mapNetwork = { allowedRequests: 0, blockedExternalRequests: 0, resources: {} };
  delete state.authLifecycle;
  const record = (status, extra = {}) => {
    Object.assign(
      state,
      {
        status,
        runtime: "sdk",
        pid: process.pid,
        userDataDirectory: userData,
        sdkConfigDirectory: config,
        directoriesVerified: true,
        windowTitle: label,
        blocker: null,
        externalRendererNetworkBlocked: false,
        rendererNetworkPolicy: "openfreemap-only",
        allowedRendererOrigin: mapOrigin,
        otherRendererHttpBlocked: true,
        mapNetwork,
        runtimeDiagnosticsFile: "sdk-session/runtime-diagnostics.json",
      },
      extra,
    );
    const temp = statePath + ".tmp";
    writeFileSync(temp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
    renameSync(temp, statePath);
  };
  let recordTimer;
  const scheduleRecord = () => {
    if (recordTimer) return;
    recordTimer = setTimeout(() => {
      recordTimer = undefined;
      record(state.status);
    }, 150);
    recordTimer.unref();
  };
  const resource = (url) => {
    const kind = mapResourceKind(url);
    if (kind === null) return null;
    return (mapNetwork.resources[kind] ??= { completed: 0, failed: 0 });
  };
  record("starting");
  // Registered before product main: only the provider already allowed by product CSP.
  // Node SDK transport, system TLS checks and product CSP stay unchanged.
  app.whenReady().then(() => {
    const requests = session.defaultSession.webRequest;
    const filter = { urls: ["http://*/*", "https://*/*"] };
    requests.onBeforeRequest(filter, (details, callback) => {
      const allowed = allowRendererHttpRequest(details.url);
      if (allowed) mapNetwork.allowedRequests += 1;
      else mapNetwork.blockedExternalRequests += 1;
      callback({ cancel: !allowed });
      scheduleRecord();
    });
    requests.onCompleted(filter, (details) => {
      const entry = resource(details.url);
      if (!entry) return;
      entry.completed += 1;
      entry.lastHttpStatus = details.statusCode;
      scheduleRecord();
    });
    requests.onErrorOccurred(filter, (details) => {
      const entry = resource(details.url);
      if (!entry) return;
      entry.failed += 1;
      entry.lastNetworkError = /^net::ERR_[A-Z0-9_]+$/.test(details.error)
        ? details.error
        : "NETWORK_ERROR";
      scheduleRecord();
    });
  });
  app.on("browser-window-created", (_event, window) => {
    window.on("page-title-updated", (event) => event.preventDefault());
    window.setTitle(label);
    window.once("ready-to-show", () => {
      window.setTitle(label);
      record("product-page-ready", {
        windowId: window.id,
        localProductPage: window.webContents.getURL() === "ninebot-desktop://app/index.html",
        credentialsCapturedByAgent: false,
      });
    });
  });
  return import(pathToFileURL(join(project, "out/main/index.js")).href).catch(() => {
    record("launch-failed", { failure: "product-main" });
    app.exit(1);
  });
};

module.exports = { allowRendererHttpRequest, mapResourceKind, launch };
if (require.main === module) {
  const root = process.env.NINEBOT_DESKTOP_ACCEPTANCE_ROOT;
  if (!root) throw new Error("NINEBOT_DESKTOP_ACCEPTANCE_ROOT is required");
  void launch({ root });
}
