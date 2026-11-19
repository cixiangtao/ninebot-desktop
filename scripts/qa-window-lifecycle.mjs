import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { _electron as electron } from "playwright";

const projectRoot = resolve(import.meta.dirname, "..");
const qaRoot = await mkdtemp(resolve(tmpdir(), "ninebot-window-qa-"));
const args = [".", `--user-data-dir=${resolve(qaRoot, "user-data")}`];
const env = { ...process.env, NINEBOT_CONFIG_DIR: resolve(qaRoot, "config") };
let app;
let secondInstance;

const launchSecondInstance = async () => {
  secondInstance = spawn(app.process().spawnfile, args, {
    cwd: projectRoot,
    env,
    stdio: "ignore",
    timeout: 15_000,
  });
  const [code] = await once(secondInstance, "exit");
  assert.equal(code, 0, "The second process should hand off and exit successfully");
};

const closeMainWindow = async () => {
  await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    await new Promise((resolveClosed) => {
      window.once("closed", resolveClosed);
      window.close();
    });
  });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 0);
};

const assertRendererReady = async (window) => {
  await window.locator(".unauthenticated-page, .app-shell").first().waitFor();
  await window.waitForFunction(() => document.documentElement.dataset.theme === "mint");
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
};

try {
  app = await electron.launch({ args, cwd: projectRoot, env });
  const initialWindow = await app.firstWindow();
  await assertRendererReady(initialWindow);

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  await launchSecondInstance();
  await initialWindow.waitForFunction(() => document.visibilityState === "visible");
  await assertRendererReady(initialWindow);

  if (process.platform === "darwin") {
    await closeMainWindow();
    const reopened = app.waitForEvent("window");
    await launchSecondInstance();
    await assertRendererReady(await reopened);

    await closeMainWindow();
    const activated = app.waitForEvent("window");
    await app.evaluate(({ app: desktopApp }) => {
      desktopApp.emit("activate");
      desktopApp.emit("second-instance", {}, [], process.cwd());
    });
    await assertRendererReady(await activated);
  }
  console.log(
    "Window lifecycle passed: initial render, second launch handoff, hidden window restore, macOS closed window reopen, concurrent activation, theme initialization.",
  );
} finally {
  if (secondInstance && secondInstance.exitCode === null) secondInstance.kill();
  await app?.close();
  await rm(qaRoot, { recursive: true, force: true });
}
