import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { _electron as electron } from "playwright";

const project = resolve(import.meta.dirname, "..");
const root = await mkdtemp(join(tmpdir(), "ninebot-accounts-ui-"));
const evidence = resolve(process.argv[2] ?? join(root, "evidence"));
const settings = async (page) => {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "添加账号", exact: true }).waitFor({ state: "visible" });
  await page.waitForFunction(
    () => !document.querySelector(".security-sheet button.quiet-button")?.disabled,
  );
};
const add = async (page, user) => {
  await page.getByRole("button", { name: "添加账号", exact: true }).click();
  await page.locator('input[autocomplete="username"]').fill(user);
  await page.locator('input[autocomplete="current-password"]').fill("qa-password");
  await page.getByRole("button", { name: "连接账号", exact: true }).click();
  await page
    .getByText(user === "qa-a" ? "账号 A 的车辆" : "账号 B 的车辆", { exact: true })
    .first()
    .waitFor();
};

let app;
try {
  await mkdir(evidence, { recursive: true });
  await build({
    configFile: false,
    root: project,
    logLevel: "warn",
    ssr: { noExternal: true },
    build: {
      ssr: true,
      emptyOutDir: true,
      outDir: join(root, "app"),
      rollupOptions: {
        input: join(project, "scripts/fixtures/desktop-accounts-main.ts"),
        external: ["electron"],
        output: { format: "es", entryFileNames: "main.mjs" },
      },
    },
  });
  const launch = async () => {
    app = await electron.launch({
      args: [join(root, "app/main.mjs")],
      cwd: project,
      env: { ...process.env, NINEBOT_ACCOUNTS_QA_ROOT: root, NINEBOT_ACCOUNTS_QA_PROJECT: project },
    });
    return app.firstWindow();
  };
  let page = await launch();
  await settings(page);
  await page.getByText("还没有保存的账号，登录成功后会自动保存在这里。", { exact: true }).waitFor();
  await add(page, "qa-a");
  assert.equal(await page.locator(".rail-account").count(), 0);
  await settings(page);
  await add(page, "qa-b");
  await app.evaluate(() => globalThis.accountsQa("expire-b"));
  await settings(page);
  await page.getByText("登录状态已失效，请重新连接", { exact: true }).waitFor();
  assert.equal(await page.locator(".saved-account-row").count(), 2);
  await page.screenshot({ path: join(evidence, "accounts-two.png") });
  const summaries = await page.evaluate(async () => (await window.ninebot.accounts.list()).data);
  assert(!JSON.stringify(summaries).includes("qa-token"));
  const a = summaries.accounts.find((row) => row.label === "q***a");
  const b = summaries.accounts.find((row) => row.label === "q***b");
  assert(a && b);
  await page
    .locator(".saved-account-row")
    .filter({ hasText: "q***a" })
    .getByRole("button", { name: "切换", exact: true })
    .click();
  await page.getByText("账号 A 的车辆", { exact: true }).first().waitFor();
  assert.equal(await page.getByText("账号 B 的车辆", { exact: true }).count(), 0);
  assert.deepEqual(await app.evaluate(() => globalThis.accountsQa()), { logins: 2, network: 0 });
  await app.close();
  app = undefined;
  page = await launch();
  await page.getByText("账号 A 的车辆", { exact: true }).first().waitFor();
  assert.deepEqual(await app.evaluate(() => globalThis.accountsQa()), { logins: 0, network: 0 });
  await settings(page);
  await page
    .locator(".saved-account-row")
    .filter({ hasText: "q***b" })
    .getByRole("button", { name: "移除 q***b", exact: true })
    .click();
  await page.getByRole("button", { name: "确认移除", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".saved-account-row").length === 1);
  await page.getByRole("button", { name: "退出当前账号", exact: true }).click();
  await page.getByRole("button", { name: "确认清除", exact: true }).click();
  await page.getByRole("dialog", { name: "设置", exact: true }).waitFor({ state: "hidden" });
  await settings(page);
  await page.getByText("还没有保存的账号，登录成功后会自动保存在这里。", { exact: true }).waitFor();
  const result = {
    addedTwo: true,
    expiredAccountAllowsSwitch: true,
    sidebarAccountRemoved: true,
    switchedWithoutLogin: true,
    previousVehicleCleared: true,
    restartRestored: true,
    removedInactive: true,
    logoutRemovedCurrent: true,
    network: 0,
  };
  await writeFile(join(evidence, "accounts-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
} finally {
  if (app) await app.close();
  await rm(root, { recursive: true, force: true });
}
