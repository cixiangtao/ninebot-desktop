// Read-only provider UI smoke: never requests SMS, supplies an account or solves a challenge.
import { mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { _electron as electron } from "playwright";

if (!process.argv.includes("--live"))
  throw new Error(
    "Use --live to explicitly load the provider's public verification widget (no SMS/login)",
  );
const project = resolve(import.meta.dirname, "..");
const root = await mkdtemp(join(tmpdir(), "ninebot-sms-widget-"));
let app;
try {
  await mkdir(join(root, "preload"));
  await copyFile(
    join(project, "out/preload/sms-verification.cjs"),
    join(root, "preload/sms-verification.cjs"),
  );
  const entry = join(root, "entry.ts");
  await writeFile(
    entry,
    `
import { app, BrowserWindow, protocol } from 'electron';
globalThis.widgetRequests = [];
globalThis.widgetErrors = [];
app.on('web-contents-created', (_event, contents) => {
 contents.on('console-message', (_event, details) => { if(details.level==='error') globalThis.widgetErrors.push(details.message.slice(0,500)); });
});
app.on('session-created', (ses) => {
 ses.webRequest.onCompleted((details)=>globalThis.widgetRequests.push({url:new URL(details.url).origin+new URL(details.url).pathname,status:details.statusCode}));
 ses.webRequest.onErrorOccurred((details)=>globalThis.widgetRequests.push({url:new URL(details.url).origin+new URL(details.url).pathname,error:details.error}));
});
import { presentSmsVerification } from ${JSON.stringify(join(project, "src/main/sms-verification-window.ts"))};
app.setPath('userData', ${JSON.stringify(join(root, "user-data"))});
protocol.registerSchemesAsPrivileged([{scheme:'ninebot-desktop',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.whenReady().then(async()=>{
 const owner = new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 await owner.loadURL('about:blank');
 globalThis.widgetOutcome = 'pending';
 globalThis.widgetFinished = presentSmsVerification(owner.webContents, new AbortController().signal).then(
   () => {globalThis.widgetOutcome = 'closed';},
   () => {globalThis.widgetOutcome = 'failed';}
 );
});
`,
  );
  await build({
    configFile: false,
    root: project,
    logLevel: "warn",
    ssr: { noExternal: true },
    build: {
      ssr: true,
      outDir: join(root, "app"),
      rollupOptions: {
        input: entry,
        external: ["electron"],
        output: { format: "es", entryFileNames: "main.mjs" },
      },
    },
  });
  app = await electron.launch({ args: [join(root, "app/main.mjs")], cwd: project });
  const owner = await app.firstWindow();
  const popup = app.windows().find((page) => page !== owner) ?? (await app.waitForEvent("window"));
  await popup.waitForURL("**/index.html");
  const failures = [];
  popup.on("console", (message) => {
    if (message.type() === "error")
      failures.push(message.text().replace(/\?.*/g, "?[omitted]").slice(0, 300));
  });
  let ready = false;
  try {
    await popup.getByText("请完成下方人机验证", { exact: true }).waitFor({ timeout: 25_000 });
    ready = true;
  } catch {
    /* Report actual readiness without claiming success. */
  }
  const outcome = await app.evaluate(() => ({
    result: globalThis.widgetOutcome,
    requests: globalThis.widgetRequests,
    errors: globalThis.widgetErrors,
  }));
  let boundary = null;
  if (!popup.isClosed()) {
    boundary = await popup.evaluate(() => ({
      noAppBridge: typeof window.ninebot === "undefined",
      noNode: typeof window.process === "undefined",
      bridge: typeof window.smsVerification,
      provider: typeof window.initNECaptcha,
      scripts: [...document.scripts].map((s) => s.src),
      widgetElements: document.querySelectorAll('[class*="yidun"]').length,
    }));
    const screenshot = resolve(
      process.argv.find((arg) => arg.startsWith("--screenshot="))?.slice(13) ??
        join(tmpdir(), "ninebot-sms-widget.png"),
    );
    await popup.screenshot({ path: screenshot, timeout: 5000 });
    console.log(JSON.stringify({ ready, outcome, boundary, screenshot, errors: failures }));
    await popup.getByRole("button", { name: "取消验证", exact: true }).click();
  } else console.log(JSON.stringify({ ready, outcome, boundary, errors: failures }));
  if (!ready) process.exitCode = 1;
} finally {
  if (app) await app.close();
  await rm(root, { recursive: true, force: true });
}
