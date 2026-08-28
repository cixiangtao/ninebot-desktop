import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { chromium } from "playwright";

const projectRoot = resolve(import.meta.dirname, "..");
const executablePath = resolve(projectRoot, "release/mac-arm64/骑迹.app/Contents/MacOS/骑迹");
const qaRoot = await mkdtemp(resolve(tmpdir(), "qiji-packaged-qa-"));
const userDataDirectory = resolve(qaRoot, "user-data");
const configDirectory = resolve(qaRoot, "ninecli");

const reservePort = async () => {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  if (!port) throw new Error("Unable to reserve a CDP port");
  return port;
};

const waitForCdp = async (port) => {
  const deadline = Date.now() + 15_000;
  const poll = async () => {
    if (Date.now() >= deadline) {
      throw new Error("Packaged app did not expose its renderer in time");
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // The packaged main process is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    return poll();
  };
  return poll();
};

const port = await reservePort();
const child = spawn(
  executablePath,
  [`--remote-debugging-port=${port}`, `--user-data-dir=${userDataDirectory}`],
  {
    cwd: projectRoot,
    env: {
      HOME: process.env.HOME,
      LANG: process.env.LANG ?? "zh_CN.UTF-8",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      TMPDIR: process.env.TMPDIR,
      NINEBOT_CONFIG_DIR: configDirectory,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let processOutput = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    processOutput = `${processOutput}${chunk}`.slice(-8_000);
  });
}

let browser;
try {
  await waitForCdp(port);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  if (!context) throw new Error("Packaged renderer context was not found");
  const page = context.pages()[0] ?? (await context.waitForEvent("page"));
  await page.waitForURL("qiji://app/**");
  await page.locator(".playback-panel").waitFor();
  const runtimeStatus = await page.evaluate(() => window.ninebot.runtime.security());
  if (
    !runtimeStatus.ok ||
    runtimeStatus.data.binary.status !== "verified" ||
    runtimeStatus.data.policy.sessionCache.storage !== "memory-only" ||
    runtimeStatus.data.policy.sessionCache.rawResponsesStored !== false ||
    runtimeStatus.data.policy.sessionCache.persistsAcrossRestarts !== false ||
    runtimeStatus.data.policy.sessionCache.manualRefreshBypasses !== true
  ) {
    throw new Error(`Packaged ninecli runtime check failed: ${JSON.stringify(runtimeStatus)}`);
  }
  await page.getByRole("button", { name: "导出本月清单" }).click();
  const monthExportDialog = page.getByRole("dialog", { name: "选择月度导出格式" });
  await monthExportDialog.waitFor();
  const monthSummaryExportReady =
    (await monthExportDialog.getByRole("button", { name: /CSV 表格/ }).isVisible()) &&
    (await monthExportDialog.getByRole("button", { name: /JSON 数据/ }).isVisible()) &&
    (await monthExportDialog.getByText(/不包含 GPS、轨迹点、车辆 SN/).isVisible());
  if (!monthSummaryExportReady) throw new Error("Packaged month summary export is incomplete");
  console.log(
    JSON.stringify({
      title: await page.title(),
      demoReady: true,
      bridgeReady: true,
      finderSafeUvxLookup: true,
      binaryVerified: true,
      sessionCacheMemoryOnly: true,
      monthSummaryExportReady,
    }),
  );
} catch (error) {
  console.error(processOutput);
  throw error;
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((resolveExit) => {
    if (child.exitCode !== null) resolveExit();
    else child.once("exit", resolveExit);
  });
  await rm(qaRoot, { recursive: true, force: true });
}
