import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants, createHash, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "ninebot-sdk-package-"));
let browser;
let server;

/** Check transitive JS and declaration imports, including type-only dependency leaks. */
const checkGraph = async (entry, seen = new Set()) => {
  if (seen.has(entry)) return;
  seen.add(entry);
  const source = await readFile(entry, "utf8");
  const imports = [...source.matchAll(/(?:from\s*|import\s*\()(["'])([^"']+)\1/g)].map(
    (match) => match[2],
  );
  await Promise.all(
    imports.map(async (specifier) => {
      assert.ok(specifier.startsWith("./"), `Nonportable import in ${entry}: ${specifier}`);
      const dependency = entry.endsWith(".d.ts")
        ? specifier.replace(/\.(?:js|ts)$/, ".d.ts")
        : specifier;
      await checkGraph(resolve(dirname(entry), dependency), seen);
    }),
  );
};

try {
  await execute("pnpm", [
    "--dir",
    join(root, "packages/ninebot-client"),
    "pack",
    "--pack-destination",
    temporary,
  ]);
  const archive = (await readdir(temporary)).find((name) => name.endsWith(".tgz"));
  assert.ok(archive, "SDK archive is missing");
  await execute("tar", ["-xzf", join(temporary, archive), "-C", temporary]);
  const packageRoot = join(temporary, "package");
  await Promise.all(
    ["index", "platform-web", "track", "transport-web"].flatMap((name) => [
      checkGraph(join(packageRoot, `dist/${name}.js`)),
      checkGraph(join(packageRoot, `dist/${name}.d.ts`)),
    ]),
  );
  await writeFile(
    join(temporary, "consumer.ts"),
    `
import {createNinebotSdk, createMemoryNinebotAuthSessionStore, type NinebotTransport} from './package/dist/index.js';
import {createNinebotWebCryptoAdapter} from './package/dist/platform-web.js';
import {getTrackMaximumPoint, parseTrail} from './package/dist/track.js';
declare const transport: NinebotTransport;
const sdk = createNinebotSdk({transport, crypto:createNinebotWebCryptoAdapter(), sessionStore:createMemoryNinebotAuthSessionStore(), deviceStore:{load:async()=>({deviceId:'test',region:'bj',osVersion:'13',osModel:'test'})}});
void sdk.travels.get({service:'ebike',serialNumber:'test',vehicleType:1,travelId:'ride'});
void getTrackMaximumPoint(parseTrail('',0));
`,
  );
  await writeFile(
    join(temporary, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2023", "DOM"],
        types: [],
        strict: true,
        noEmit: true,
      },
      files: ["consumer.ts"],
    }),
  );
  await execute(join(root, "node_modules/.bin/tsc"), ["-p", join(temporary, "tsconfig.json")]);
  const legacy = await import(pathToFileURL(join(packageRoot, "dist/node.js")).href);
  assert.equal(typeof legacy.createNinebotNodeAuthSessionManager, "function");
  const native = await import(pathToFileURL(join(packageRoot, "dist/crypto-node.js")).href);
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
  const calls = [];
  server = createServer(async (request, response) => {
    try {
      if (request.url === "/") {
        response.setHeader("Content-Type", "text/html");
        response.end("<!doctype html><title>SDK offline verification</title>");
        return;
      }
      const pathname = new URL(request.url, "http://localhost").pathname;
      assert.match(pathname, /^\/dist\/[a-z0-9-]+\.js$/);
      response.setHeader("Content-Type", "text/javascript");
      response.end(await readFile(join(packageRoot, pathname)));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  await page.exposeFunction("offlinePeer", (request) => {
    calls.push(request.path);
    const envelope = JSON.parse(Buffer.from(request.body).toString());
    if (request.service === "passport")
      return JSON.stringify({
        resultCode: 90000,
        data: {
          access_token: "test-token",
          refresh_token: "test-refresh",
          uuid: "test-uuid",
          accessTokenValidity: String(Date.now() + 3600000),
        },
      });
    const block = privateDecrypt(
      { key: privateKey, padding: constants.RSA_NO_PADDING },
      Buffer.from(envelope.k, "base64"),
    );
    const plaintext = native.decryptAesCbcPkcs7({
      ciphertext: Buffer.from(envelope.d, "base64"),
      key: block.subarray(block.indexOf(0, 2) + 1),
    });
    assert.equal(createHash("md5").update(plaintext).digest("hex"), envelope.h);
    const wrapper = JSON.parse(Buffer.from(plaintext).toString());
    const fields = JSON.parse(Buffer.from(wrapper.data, "base64").toString());
    const { checkcode, ...unsigned } = fields;
    assert.equal(
      createHash("md5").update(JSON.stringify(unsigned)).digest("hex").toUpperCase(),
      checkcode,
    );
    let payload;
    if (request.service === "business") payload = { code: 1, data: { uid: "test-business-uid" } };
    else {
      assert.equal(fields.uid, "test-business-uid");
      if (request.path.includes("my-vehicle")) payload = { code: 1, data: [{ sn: "test-sn" }] };
      else if (request.path.includes("travel-list2"))
        payload = {
          month: "202610",
          times: 1,
          duration: 120,
          total_mileages: 1,
          ec: 20,
          first_time: null,
          detail: [],
          list: [{ id: "ride" }],
        };
      else
        payload = {
          code: 1,
          desc: null,
          data: { trail: "116.1,39.1,12;116.2,39.2,48;116.3,39.3,20" },
        };
    }
    const key = native.deriveNinebotKeyCandidate(
      [wrapper.keyDataOne, wrapper.keyDataTwo, wrapper.keyDataThree, wrapper.keyDataFour].map(
        (value) => new TextEncoder().encode(value),
      ),
    );
    const inner = new TextEncoder().encode(
      JSON.stringify({ data: Buffer.from(JSON.stringify(payload)).toString("base64") }),
    );
    return JSON.stringify({
      v: 101,
      s: "test-only",
      r: Buffer.from(native.encryptAesCbcPkcs7({ plaintext: inner, key })).toString("base64"),
    });
  });
  await page.goto(origin);
  const result = await page.evaluate(
    async (rsaPublicKey) => {
      const sdk = await import("/dist/index.js");
      const web = await import("/dist/platform-web.js");
      const track = await import("/dist/track.js");
      const store = sdk.createMemoryNinebotAuthSessionStore();
      const options = {
        crypto: web.createNinebotWebCryptoAdapter({ rsaPublicKey }),
        sessionStore: store,
        deviceStore: {
          load: async () => ({
            deviceId: "test-device",
            region: "bj",
            osVersion: "13",
            osModel: "test",
          }),
        },
        transport: {
          send: async (request) => ({
            status: 200,
            headers: {},
            body: new TextEncoder().encode(
              await window.offlinePeer({ ...request, body: Array.from(request.body) }),
            ),
          }),
        },
      };
      const client = sdk.createNinebotSdk(options);
      await client.auth.loginWithPassword({ areaCode: "86", user: "test", password: "test" });
      const request = { service: "ebike", serialNumber: "test-sn", vehicleType: 14363 };
      const vehicles = await client.vehicles.list(request);
      const month = await client.travels.list({ ...request, month: "202610" });
      const detail = await client.travels.get({ ...request, travelId: "ride" });
      const points = track.parseTrail(detail.trail, 120);
      const maximum = track.getTrackMaximumPoint(points);
      const restored = sdk.createNinebotSdk(options);
      const session = await restored.auth.restore();
      await restored.auth.logout();
      return {
        nodeAbsent:
          typeof globalThis.process === "undefined" && typeof globalThis.Buffer === "undefined",
        vehicleCount: vehicles.data.length,
        rideCount: month.list.length,
        maximumSpeed: maximum?.point.speed,
        maximumIndex: maximum?.index,
        restored: session?.businessUid === "test-business-uid",
        cleared: (await store.load()) === null,
      };
    },
    publicKey.export({ type: "spki", format: "pem" }),
  );
  assert.deepEqual(result, {
    nodeAbsent: true,
    vehicleCount: 1,
    rideCount: 1,
    maximumSpeed: 48,
    maximumIndex: 1,
    restored: true,
    cleared: true,
  });
  assert.equal(calls.length, 5);
  console.log(
    JSON.stringify({
      packed: true,
      portableImportGraphs: true,
      isolatedNodeImport: true,
      browser: result,
      syntheticRequests: calls.length,
    }),
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  await rm(temporary, { recursive: true, force: true });
}
