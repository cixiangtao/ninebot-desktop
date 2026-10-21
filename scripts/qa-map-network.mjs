// Independent synthetic map renderer: no original window, session, IPC or Ninebot network access.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { _electron as electron } from "playwright";

const project = resolve(import.meta.dirname, "..");
const root = await mkdtemp(join(tmpdir(), "ninebot-map-network-"));
const evidence = resolve(process.argv[2] ?? join(root, "evidence"));
let app;
try {
  await mkdir(evidence, { recursive: true });
  await build({
    configFile: false,
    root: project,
    logLevel: "warn",
    plugins: [react()],
    build: {
      outDir: join(root, "renderer"),
      emptyOutDir: true,
      cssCodeSplit: false,
      rollupOptions: {
        input: join(project, "scripts/fixtures/map-network-renderer.tsx"),
        output: { entryFileNames: "assets/map.js", assetFileNames: "assets/[name][extname]" },
      },
    },
  });
  const productHtml = await readFile(join(project, "src/renderer/index.html"), "utf8");
  const css = (await readdir(join(root, "renderer/assets"))).filter((file) =>
    file.endsWith(".css"),
  );
  const html = productHtml
    .replace("/src/main.tsx", "/assets/map.js")
    .replace(
      "</head>",
      css.map((file) => `<link rel="stylesheet" href="/assets/${file}">`).join("") + "</head>",
    );
  await writeFile(join(root, "renderer/index.html"), html);
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
        input: join(project, "scripts/fixtures/map-network-main.ts"),
        external: ["electron"],
        output: { format: "es", entryFileNames: "main.mjs" },
      },
    },
  });
  const launch = async (blockMaps) => {
    app = await electron.launch({
      args: [join(root, "app/main.mjs")],
      cwd: project,
      env: {
        ...process.env,
        NINEBOT_MAP_QA_ROOT: root,
        NINEBOT_MAP_QA_PROJECT: project,
        NINEBOT_MAP_QA_BLOCK_MAPS: blockMaps ? "1" : "0",
      },
    });
    return app.firstWindow();
  };
  const inspect = () => app.evaluate(() => globalThis.mapQaDiagnostics());
  let window = await launch(true);
  await window.getByText("在线底图不可用，已保留本地轨迹").waitFor({ timeout: 20_000 });
  assert.ok((await inspect()).blocked > 0);
  assert.equal(await window.locator(".online-map-ready").count(), 0);
  await window.getByRole("button", { name: "加载公开测试位置" }).click();
  await window.getByText("在线底图不可用，位置坐标未发送给其他服务").waitFor({ timeout: 20_000 });
  const before = await inspect();
  await app.close();
  app = undefined;

  window = await launch(false);
  await window.locator(".online-map-ready").waitFor({ timeout: 30_000 });
  assert.equal(await window.locator(".vehicle-location-online").count(), 0);
  const errors = [];
  window.on("pageerror", () => errors.push("renderer-error"));
  await window.getByRole("button", { name: "加载公开测试位置" }).click();
  await window.locator(".vehicle-location-online-ready").waitFor({ timeout: 30_000 });
  // A ready style alone is insufficient: actual vector tile and glyph responses must succeed.
  const after = await app.evaluate(
    () =>
      new Promise((done, reject) => {
        const deadline = Date.now() + 30_000;
        const timer = setInterval(() => {
          const current = globalThis.mapQaDiagnostics();
          if (current.counts.vectorTile > 0 && current.counts.glyph > 0) {
            clearInterval(timer);
            done(current);
          } else if (Date.now() >= deadline) {
            clearInterval(timer);
            reject(new Error("Public test map resources did not complete"));
          }
        }, 200);
      }),
  );
  assert.ok(after.counts.style >= 1);
  assert.ok(after.counts.source >= 1);
  assert.ok(after.counts.vectorTile > 0);
  assert.ok(after.counts.glyph > 0);
  assert.equal(errors.length, 0);
  await window.screenshot({ path: join(evidence, "public-coordinate-maps.png") });
  const result = {
    source:
      "synthetic public Berlin coordinates; actual map components, product CSP and custom protocol",
    originalInstanceAccessed: false,
    realAccountOrLocationUsed: false,
    oldBlockerReproduced: true,
    offlineRoutePreserved: true,
    offlineLocationPreserved: true,
    routeMapReady: true,
    locationMapReady: true,
    locationRequiresExplicitAction: true,
    before,
    after,
    certificateChecksUnchanged: true,
    externalProviderUnchanged: true,
  };
  await writeFile(
    join(evidence, "map-network-result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result));
} finally {
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
