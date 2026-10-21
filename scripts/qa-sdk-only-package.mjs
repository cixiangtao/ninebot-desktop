import { strict as assert } from "node:assert";
import childProcess from "node:child_process";
import fs from "node:fs";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { asarTools, assertSdkOnlyArchive } from "./sdk-only-audit.ts";

// This does not launch Electron, access a display, or attach a debugger. It executes
// the packaged main/preload with only Electron's native boundary substituted.
const root = resolve(import.meta.dirname, "..");
const app = process.argv.find((arg) => arg.startsWith("--app="))?.slice(6);
if (!app) throw new Error("Pass an explicit SDK-only --app path");
if (!vm.SourceTextModule) throw new Error("Run this harness with --experimental-vm-modules");
const resources = join(
  resolve(app),
  process.platform === "darwin" ? "Contents/Resources" : "resources",
);
const archive = join(resources, "app.asar");
const tools = asarTools(root);
const mainSource = tools.extractFile(archive, "out/main/index.js").toString("utf8");
assertSdkOnlyArchive(
  tools.listPackage(archive).map((file) => file.replaceAll("\\", "/")),
  JSON.parse(tools.extractFile(archive, "package.json").toString("utf8")),
  mainSource,
);
const qaRoot = await realpath(await mkdtemp(join(tmpdir(), "ninebot-sdk-package-offline-")));
const unpacked = join(qaRoot, "app");
const config = join(qaRoot, "synthetic-config");
const handlers = new Map();
const events = new Map();
const protocolHandlers = new Map();
const windows = [];
let startup;
let permissionHandler;
let bridge;
let networkCalls = 0;
let subprocessCalls = 0;
let forbiddenReads = 0;
const fetchBefore = globalThis.fetch;
const readBefore = fs.promises.readFile;
const childBefore = new Map();
const noNetwork = async () => {
  networkCalls += 1;
  throw new Error("Offline QA forbids network");
};

try {
  tools.extractAll(archive, unpacked);
  await mkdir(config);
  await writeFile(
    join(config, "config.json"),
    JSON.stringify({
      device_id: "synthetic-device",
      region: "bj",
      os_version: "13",
      os_model: "synthetic",
    }),
  );
  // Canaries are synthetic, and reading either is an explicit harness failure.
  await writeFile(join(config, "tokens.json"), "synthetic legacy session must be ignored");
  await writeFile(join(config, "vehicles.json"), "synthetic ownerless cache must be ignored");
  globalThis.fetch = noNetwork;
  fs.promises.readFile = async (path, ...args) => {
    const target = path instanceof URL ? fileURLToPath(path) : String(path);
    if (
      !resolve(target).startsWith(`${qaRoot}${sep}`) ||
      target === join(config, "tokens.json") ||
      target === join(config, "vehicles.json")
    ) {
      forbiddenReads += 1;
      throw new Error("Offline QA forbids this file read");
    }
    return readBefore(path, ...args);
  };
  for (const name of [
    "spawn",
    "spawnSync",
    "exec",
    "execSync",
    "execFile",
    "execFileSync",
    "fork",
  ]) {
    childBefore.set(name, childProcess[name]);
    childProcess[name] = () => {
      subprocessCalls += 1;
      throw new Error("Offline QA forbids subprocesses");
    };
  }
  syncBuiltinESMExports();
  class Window {
    constructor(options) {
      this.options = options;
      this.url = "";
      this.webContents = {
        setWindowOpenHandler() {},
        on() {},
        getURL: () => this.url,
        reload() {},
      };
      windows.push(this);
    }
    static getAllWindows() {
      return windows;
    }
    async loadURL(url) {
      this.url = url;
    }
    once() {}
    show() {}
    isDestroyed() {
      return false;
    }
  }
  const electron = {
    app: {
      requestSingleInstanceLock: () => true,
      getPath: () => join(qaRoot, "synthetic-user-data"),
      getAppPath: () => unpacked,
      isPackaged: true,
      whenReady: () => ({
        // eslint-disable-next-line unicorn/no-thenable -- Capture Electron's startup promise in this offline boundary mock.
        then: (callback) => {
          startup = Promise.resolve().then(callback);
          return startup;
        },
      }),
      on: (name, callback) => events.set(name, callback),
      quit: () => {
        throw new Error("Unexpected application quit");
      },
    },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    BrowserWindow: Window,
    Menu: { setApplicationMenu() {} },
    dialog: {
      showSaveDialog: () => {
        throw new Error("Unexpected export dialog");
      },
    },
    protocol: {
      registerSchemesAsPrivileged() {},
      handle: (name, handler) => protocolHandlers.set(name, handler),
    },
    session: {
      defaultSession: {
        setPermissionRequestHandler: (handler) => {
          permissionHandler = handler;
        },
      },
    },
    shell: { openExternal: noNetwork },
    net: { fetch: noNetwork },
  };
  const sandbox = vm.createContext({
    console,
    Buffer,
    URL,
    Response,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    fetch: noNetwork,
    process: {
      platform: process.platform,
      arch: process.arch,
      resourcesPath: resources,
      env: {
        NINEBOT_CONFIG_DIR: config,
        NINEBOT_AUTH_SOURCE: "legacy",
        NINEBOT_VEHICLE_SOURCE: "ninecli",
        NINEBOT_TRAVEL_SOURCE: "ninecli",
      },
    },
  });
  const namespaceModule = (name, namespace) => {
    const names = Object.keys(namespace);
    return new vm.SyntheticModule(
      names,
      function () {
        for (const key of names) this.setExport(key, namespace[key]);
      },
      { context: sandbox, identifier: name },
    );
  };
  const mainPath = join(unpacked, "out/main/index.js");
  const main = new vm.SourceTextModule(mainSource, {
    context: sandbox,
    identifier: mainPath,
    initializeImportMeta: (meta) => {
      meta.dirname = dirname(mainPath);
      meta.url = pathToFileURL(mainPath).href;
    },
  });
  await main.link(async (name) => {
    if (name === "electron") return namespaceModule(name, electron);
    assert(!/child_process/.test(name), "SDK main imported a subprocess module");
    const location = name.startsWith("node:")
      ? name
      : import.meta.resolve(name, pathToFileURL(mainPath).href);
    if (!name.startsWith("node:"))
      assert(
        location.startsWith(pathToFileURL(`${unpacked}${sep}`).href),
        `Harness dependency escaped the packaged artifact: ${name} -> ${location}`,
      );
    const namespace = await import(location);
    return namespaceModule(name, namespace);
  });
  await main.evaluate();
  assert(startup, "Packaged main did not initialize");
  await startup;
  assert.equal(windows.length, 1);
  assert.equal(windows[0].url, "ninebot-desktop://app/index.html");
  assert.deepEqual(windows[0].options.webPreferences.contextIsolation, true);
  assert.equal(windows[0].options.webPreferences.nodeIntegration, false);
  assert.equal(windows[0].options.webPreferences.sandbox, true);
  assert(protocolHandlers.has("ninebot-desktop"));
  let permission;
  permissionHandler(null, "geolocation", (allowed) => {
    permission = allowed;
  });
  assert.equal(permission, false);
  const preload = await readFile(join(unpacked, "out/preload/index.cjs"), "utf8");
  vm.runInNewContext(preload, {
    addEventListener() {},
    require: (name) => {
      assert.equal(name, "electron");
      return {
        contextBridge: {
          exposeInMainWorld: (bridgeName, api) => {
            assert.equal(bridgeName, "ninebot");
            bridge = api;
          },
        },
        ipcRenderer: {
          invoke: (channel, ...args) => handlers.get(channel)?.(null, ...args),
          on() {},
          removeListener() {},
        },
      };
    },
    console,
    exports: {},
  });
  // Register the real IPC main handlers in the same mock native boundary.
  // This assignment occurs before module execution via the object passed above.
  assert(bridge, "Packaged preload did not expose its bridge");
  const status = await bridge.runtime.security();
  assert.equal(status.ok, true);
  assert.equal(status.data.version, "typescript-sdk");
  assert.equal(status.data.binary.status, "not-required");
  assert(Object.values(status.data.candidate.domains).every((source) => source === "candidate"));
  const auth = await bridge.auth.status();
  assert.equal(auth.ok, true);
  assert.equal(auth.data.connected, false);
  const vehicles = await bridge.vehicles.list();
  assert.equal(vehicles.ok, false);
  assert.equal(vehicles.error.code, "AUTH_REQUIRED");
  assert.equal(networkCalls, 0);
  assert.equal(subprocessCalls, 0);
  assert.equal(forbiddenReads, 0);
  events.get("before-quit")?.();
  console.log(
    JSON.stringify({
      verification: "packaged-main-preload-offline-harness",
      electronUiLaunched: false,
      coldStart: true,
      preloadBridge: true,
      sdkPinnedDespiteLegacyEnvironment: true,
      unauthenticatedClosed: true,
      permissionDenied: true,
      networkCalls,
      subprocessCalls,
      forbiddenReads,
      realAccountUsed: false,
    }),
  );
} finally {
  globalThis.fetch = fetchBefore;
  fs.promises.readFile = readBefore;
  for (const [name, value] of childBefore) childProcess[name] = value;
  syncBuiltinESMExports();
  await rm(qaRoot, { recursive: true, force: true });
}
