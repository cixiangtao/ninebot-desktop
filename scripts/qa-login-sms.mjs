// Synthetic SMS UI regression; no messages, real credentials, original windows or account stores.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { build } from "vite";
import { _electron as electron } from "playwright";

const project = resolve(import.meta.dirname, "..");
const root = await mkdtemp(join(tmpdir(), "ninebot-sms-ui-"));
const evidence = resolve(process.argv[2] ?? join(root, "evidence"));
const sentText = "验证码请求已发送，请查看短信。验证码将提交给九号完成认证。";
const openSms = async (window) => {
  await window.getByRole("button", { name: "连接九号账号", exact: true }).last().click();
  await window.getByRole("tab", { name: "短信验证码", exact: true }).click();
};
const ready = (window) => window.getByRole("button", { name: "验证码登录", exact: true }).waitFor();

let app;
try {
  await mkdir(evidence, { recursive: true });
  await mkdir(join(root, "session"));
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
  const qa = (command) =>
    app.evaluate(async (_electron, name) => globalThis.ninebotAuthQa(name), command);
  let window = await launch();
  await openSms(window);
  await qa("sms-allow");
  await qa("sms-hold");
  await window.locator('input[autocomplete="tel"]').fill("15500000001");
  await window.getByRole("button", { name: "发送验证码", exact: true }).click();
  assert.equal((await qa("inspect")).smsRequests, 1);
  await window.locator('input[autocomplete="tel"]').fill("15500000002");
  await qa("sms-release");
  await ready(window);
  assert.equal(
    await window.getByText(sentText, { exact: true }).count(),
    0,
    "old phone response must not mark the new phone as sent",
  );

  await qa("sms-hold");
  await window.getByRole("button", { name: "发送验证码", exact: true }).click();
  await window.getByLabel("国家码", { exact: true }).fill("1");
  await qa("sms-release");
  await ready(window);
  assert.equal(
    await window.getByText(sentText, { exact: true }).count(),
    0,
    "changed country code must invalidate the old send",
  );

  await qa("sms-hold");
  await window.getByRole("button", { name: "发送验证码", exact: true }).click();
  await window.getByRole("tab", { name: "密码登录", exact: true }).click();
  await qa("sms-release");
  await window.getByRole("tab", { name: "短信验证码", exact: true }).click();
  await ready(window);
  assert.equal(
    await window.getByText(sentText, { exact: true }).count(),
    0,
    "mode change must invalidate the old send",
  );

  await qa("sms-hold");
  await window.getByRole("button", { name: "发送验证码", exact: true }).click();
  await window.getByRole("button", { name: "关闭登录", exact: true }).click();
  await qa("sms-release");
  await openSms(window);
  await ready(window);
  assert.equal(
    await window.getByText(sentText, { exact: true }).count(),
    0,
    "closed form must not inherit a late SMS response",
  );
  await window.locator('input[autocomplete="tel"]').fill("15500000002");
  await window.getByRole("button", { name: "发送验证码", exact: true }).click();
  await window.getByText(sentText, { exact: true }).waitFor();
  await window.locator('input[autocomplete="one-time-code"]').fill("123456");
  await window.locator('input[autocomplete="tel"]').fill("15500000003");
  assert.equal(
    await window.locator('input[autocomplete="one-time-code"]').inputValue(),
    "",
    "phone change must clear the old code",
  );
  assert.equal(await window.getByText(sentText, { exact: true }).count(), 0);
  assert.equal(
    await window.getByRole("button", { name: "验证码登录", exact: true }).isDisabled(),
    true,
  );
  assert.equal((await qa("inspect")).smsLogins, 0);
  assert.equal((await qa("inspect")).networkAttempts, 0);
  await app.close();
  app = undefined;

  window = await launch();
  await openSms(window);
  await qa("sms-allow");
  await window.locator('input[autocomplete="tel"]').fill("15500000001");
  await window.getByRole("button", { name: "发送验证码", exact: true }).click();
  await window.getByText(sentText, { exact: true }).waitFor();
  await window.locator('input[autocomplete="one-time-code"]').fill("123456");
  await window.getByRole("button", { name: "验证码登录", exact: true }).click();
  await window.getByText("离线验收车辆", { exact: true }).first().waitFor();
  const final = await qa("inspect");
  assert.equal(final.smsRequests, 1);
  assert.equal(final.smsLogins, 1);
  assert.equal(final.networkAttempts, 0);
  const result = {
    scope: "synthetic Electron SMS login only",
    changedPhoneIgnoresLateSend: true,
    changedCountryIgnoresLateSend: true,
    changedModeIgnoresLateSend: true,
    closedFormIgnoresLateSend: true,
    phoneChangeClearsCode: true,
    staleCodeCannotSubmit: true,
    ordinarySmsLoginWorks: true,
    networkRequests: final.networkAttempts,
    originalInstanceAccessed: false,
  };
  await writeFile(join(evidence, "sms-ui-result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
