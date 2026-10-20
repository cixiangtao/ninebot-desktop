// Real Electron/preload/IPC/renderer, synthetic SDK provider, private temporary files, no network.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, access, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { build } from "vite";
import { _electron as electron } from "playwright";

const project = resolve(import.meta.dirname, "..");
const root = await mkdtemp(join(tmpdir(), "ninebot-desktop-auth-qa-"));
const evidence = process.argv[2] ? resolve(process.argv[2]) : join(root, "evidence");
const signIn = async (window, password = "qa-password") => {
  if (!(await window.getByRole("dialog", { name: "连接九号账号" }).count()))
    await window.getByRole("button", { name: "连接九号账号", exact: true }).last().click();
  const dialog = window.getByRole("dialog", { name: "连接九号账号" });
  await dialog.getByLabel("手机号或用户名").fill("qa-user");
  await dialog.getByLabel("密码", { exact: true }).fill(password);
  await dialog.getByRole("button", { name: "连接账号", exact: true }).click();
};
let app;
try {
  await mkdir(evidence, { recursive: true });
  await mkdir(join(root, "session"));
  const legacy = "synthetic legacy sentinel: must remain byte-identical";
  await writeFile(join(root, "session/tokens.json"), legacy);
  await build({
    configFile: false,
    root: project,
    logLevel: "warn",
    ssr: { noExternal: true },
    build: {
      ssr: true,
      outDir: join(root, "app"),
      emptyOutDir: true,
      rollupOptions: {
        input: join(project, "scripts/fixtures/desktop-auth-main.ts"),
        external: ["electron"],
        output: { format: "es", entryFileNames: "main.mjs" },
      },
    },
  });
  const launch = async () => {
    app = await electron.launch({
      args: [join(root, "app/main.mjs")],
      cwd: project,
      env: { ...process.env, NINEBOT_AUTH_QA_ROOT: root, NINEBOT_AUTH_QA_PROJECT: project },
    });
    return app.firstWindow();
  };
  const qa = (name) =>
    app.evaluate(async (_electron, requested) => globalThis.ninebotAuthQa(requested), name);
  let window = await launch();
  await window.getByRole("heading", { name: "连接账号后查看真实数据" }).waitFor();
  await signIn(window, "wrong-fake-password");
  await window.getByRole("alert").waitFor();
  assert.equal(await window.getByRole("dialog", { name: "连接九号账号" }).count(), 1);
  await signIn(window);
  await window.getByText("离线验收车辆", { exact: true }).first().waitFor();
  await window.screenshot({ path: join(evidence, "desktop-auth-connected.png") });
  assert.equal((await qa("inspect")).refreshes, 0);
  assert.equal((await qa("inspect")).networkAttempts, 0);
  await app.close();
  app = undefined;
  window = await launch();
  await window.getByText("离线验收车辆", { exact: true }).first().waitFor();
  await qa("expire");
  const refreshed = await window.evaluate(() => window.ninebot.auth.profile());
  assert.equal(refreshed.ok, true);
  assert.equal((await qa("inspect")).refreshes, 1);
  await qa("reject-refresh");
  const expired = await window.evaluate(() => window.ninebot.vehicles.list());
  assert.equal(expired.ok, false);
  await window.getByRole("dialog", { name: "连接九号账号" }).waitFor();
  assert.equal(await window.getByText("离线验收车辆", { exact: true }).count(), 0);
  await access(join(root, "session/auth-session.json"));
  await window.screenshot({ path: join(evidence, "desktop-auth-expired.png") });
  await qa("allow-login");
  await qa("empty-vehicles");
  await signIn(window);
  await window.getByRole("heading", { name: "账号已连接，暂无车辆数据" }).waitFor();
  assert.equal(await window.getByText("尚未连接账号", { exact: true }).count(), 0);
  await window.screenshot({ path: join(evidence, "desktop-auth-no-vehicle.png") });
  await window.getByRole("button", { name: "设置", exact: true }).click();
  await window.getByRole("button", { name: "退出并清除令牌", exact: true }).click();
  await window.getByRole("button", { name: "确认清除", exact: true }).click();
  await window.getByRole("heading", { name: "连接账号后查看真实数据" }).waitFor();
  await assert.rejects(access(join(root, "session/auth-session.json")));
  assert.equal(await readFile(join(root, "session/tokens.json"), "utf8"), legacy);
  assert.equal((await qa("inspect")).networkAttempts, 0);
  await app.close();
  app = undefined;
  window = await launch();
  await window.getByRole("heading", { name: "连接账号后查看真实数据" }).waitFor();
  const result = {
    passwordLogin: true,
    failedLoginStaysOpen: true,
    restartRestore: true,
    autoRefresh: true,
    expiredReturnsToLogin: true,
    expiredClearsView: true,
    noVehicleStillConnected: true,
    logoutClearsSdkOnly: true,
    restartAfterLogoutDisconnected: true,
    networkRequests: (await qa("inspect")).networkAttempts,
  };
  await writeFile(
    join(evidence, "desktop-auth-result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
