import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { _electron as electron } from "playwright";

const projectRoot = resolve(import.meta.dirname, "..");
const qaRoot = await mkdtemp(resolve(tmpdir(), "qiji-recovery-qa-"));
const app = await electron.launch({
  args: [".", `--user-data-dir=${resolve(qaRoot, "user-data")}`],
  cwd: projectRoot,
  env: { ...process.env, NINEBOT_CONFIG_DIR: resolve(qaRoot, "ninecli") },
});
const window = await app.firstWindow();

const waitForMainWindowUrl = async (pattern) => {
  const deadline = Date.now() + 12_000;
  const poll = async () => {
    const url = await app.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.getURL() ?? "",
    );
    if (pattern.test(url)) return url;
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${pattern}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 120));
    return poll();
  };
  return poll();
};

try {
  await window.locator(".playback-panel").waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer();
  });
  await waitForMainWindowUrl(/^qiji:\/\/app\/recovery\.html/);
  const recoveryState = await app.evaluate(async ({ BrowserWindow }) => {
    const webContents = BrowserWindow.getAllWindows()[0]?.webContents;
    return webContents?.executeJavaScript(`({
      heading: document.querySelector('h1')?.textContent,
      reason: document.querySelector('#reason')?.textContent
    })`);
  });
  await app.evaluate(async ({ BrowserWindow }) => {
    const webContents = BrowserWindow.getAllWindows()[0]?.webContents;
    await webContents?.executeJavaScript(`document.querySelector('#reload')?.click()`);
  });
  await waitForMainWindowUrl(/^qiji:\/\/app\/index\.html$/);
  const reloadSucceeded = await app.evaluate(async ({ BrowserWindow }) => {
    const webContents = BrowserWindow.getAllWindows()[0]?.webContents;
    return webContents?.executeJavaScript(`document.querySelector('.playback-panel') !== null`);
  });
  const result = {
    recoveryVisible: recoveryState?.heading === "界面需要重新加载",
    reasonVisible: recoveryState?.reason?.startsWith("渲染进程") === true,
    reloadSucceeded: reloadSucceeded === true,
  };
  if (!Object.values(result).every(Boolean)) {
    throw new Error(
      `Recovery QA failed: ${JSON.stringify({ ...result, reason: recoveryState?.reason })}`,
    );
  }
  console.log(JSON.stringify(result));
} finally {
  await app.close();
  await rm(qaRoot, { recursive: true, force: true });
}
