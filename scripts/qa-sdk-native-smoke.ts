import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { verifySdkOnlyPackage } from "./sdk-only-audit.ts";

if (process.platform !== "darwin") throw new Error("This acceptance run is Mac-only");
const project = resolve(import.meta.dirname, "..");
const appOverride = process.argv.find((argument) => argument.startsWith("--app="))?.slice(6);
const app = resolve(appOverride ?? resolve(project, "release/sdk-only/mac-arm64/韭号出行.app"));
const output = process.argv.find((argument) => argument.startsWith("--evidence="))?.slice(11);
if (!output) throw new Error("Choose an explicit --evidence JSON output path");
await verifySdkOnlyPackage(project, app, "darwin");
const root = await realpath(await mkdtemp(join(tmpdir(), "ninebot-sdk-native-smoke-")));
const userData = join(root, "user-data");
const config = join(root, "config");
await Promise.all([mkdir(userData), mkdir(config)]);
await writeFile(join(root, "offline-smoke.marker"), "sdk-only-offline-v1", { mode: 0o600 });
let proxyRequests = 0;
const proxy = createServer((_request, response) => {
  proxyRequests += 1;
  response.writeHead(403).end();
});
proxy.on("connect", (_request, socket) => {
  proxyRequests += 1;
  socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
});
await new Promise<void>((ready, reject) => {
  proxy.once("error", reject);
  proxy.listen(0, "127.0.0.1", ready);
});
const address = proxy.address();
if (!address || typeof address === "string") throw new Error("Offline proxy did not bind");
const child = spawn(
  join(app, "Contents/MacOS/韭号出行"),
  [
    `--user-data-dir=${userData}`,
    "--use-mock-keychain",
    "--disable-background-networking",
    `--proxy-server=http://127.0.0.1:${address.port}`,
    "--host-resolver-rules=MAP * ~NOTFOUND,EXCLUDE localhost",
  ],
  {
    cwd: project,
    env: {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
      ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
      LANG: "zh_CN.UTF-8",
      NINEBOT_CONFIG_DIR: config,
      NINEBOT_SDK_OFFLINE_SMOKE_ROOT: root,
      NINEBOT_AUTH_SOURCE: "legacy",
    },
    stdio: ["ignore", "ignore", "pipe"],
  },
);
let stderrCategory = "none";
child.stderr?.on("data", (chunk: Buffer) => {
  // No raw native output is written to evidence.
  if (/WindowServer|cannot open display|display.*unavailable/i.test(chunk.toString()))
    stderrCategory = "display-unavailable";
});
let exited = false;
const exit = new Promise<void>((done) =>
  child.once("exit", () => {
    exited = true;
    done();
  }),
);
let report: Record<string, unknown> | null = null;
let completed = false;
let forbiddenChild = false;
let scopedChildCount = 0;
try {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (exited) break;
    try {
      // eslint-disable-next-line no-await-in-loop -- Poll this process's fixed, non-secret report only.
      report = JSON.parse(await readFile(join(root, "native-smoke-report.json"), "utf8")) as Record<
        string,
        unknown
      >;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (report?.completed === true) {
      completed = true;
      break;
    }
    // eslint-disable-next-line no-await-in-loop -- A bounded native-startup wait, not a recurring monitor.
    await delay(100);
  }
  if (completed && child.pid) {
    let descendants = "";
    try {
      descendants = execFileSync("/usr/bin/pgrep", ["-P", String(child.pid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      if ((error as { status?: number }).status !== 1) throw error;
    }
    const ids = descendants
      .trim()
      .split(/\s+/)
      .filter((value) => /^\d+$/.test(value));
    scopedChildCount = ids.length;
    for (const pid of ids) {
      const name = execFileSync("/bin/ps", ["-p", pid, "-o", "comm="], { encoding: "utf8" });
      if (/ninecli/i.test(name)) forbiddenChild = true;
    }
  }
} finally {
  if (!exited) child.kill("SIGTERM");
  await Promise.race([exit, delay(5_000)]);
  if (!exited) {
    child.kill("SIGKILL");
    await exit;
  }
  await new Promise<void>((done) => proxy.close(() => done()));
  const result = {
    verification: "real-electron-native-offline",
    pid: child.pid ?? null,
    completed,
    nativeReport: report,
    scopedChildCount,
    ninecliChildObserved: forbiddenChild,
    proxyRequestsBlocked: proxyRequests,
    processExited: exited,
    exitCode: child.exitCode,
    stderrCategory,
    visualInspection: false,
    realAccountUsed: false,
    keychain: "mock",
    protectedUiAccessAttempted: false,
  };
  await writeFile(resolve(output), JSON.stringify(result, null, 2), { mode: 0o600 });
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify(result));
}
if (!completed || forbiddenChild) process.exitCode = 1;
