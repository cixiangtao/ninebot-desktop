import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, open, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

if (process.platform !== "win32") {
  throw new Error("Windows package verification must run on Windows");
}

const run = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const appDirectory = resolve(projectRoot, "release/win-unpacked");
const executablePath = resolve(appDirectory, "韭号出行.exe");
const resourcesPath = resolve(appDirectory, "resources");
const asarPath = resolve(resourcesPath, "app.asar");
const ninecliPath = resolve(resourcesPath, "runtime/ninecli/ninecli.exe");
const expectedNinecliSha256 = "94338e423b1d5219a2f6bfeda9af34271b83814ef725220c2598676ac18d650e";
const verifyArtifacts = process.argv.includes("--artifacts");

const require = createRequire(import.meta.url);
const builderPath = require.resolve("electron-builder");
const appBuilderPath = require.resolve("app-builder-lib", { paths: [dirname(builderPath)] });
const asarModulePath = require.resolve("@electron/asar", { paths: [dirname(appBuilderPath)] });
const fusesModulePath = require.resolve("@electron/fuses", { paths: [dirname(appBuilderPath)] });
const { listPackage } = require(asarModulePath);
const { getCurrentFuseWire } = require(fusesModulePath);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const sha256 = (path) =>
  new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });

const readPeMachine = async (path) => {
  const handle = await open(path, "r");
  try {
    const offsetBuffer = Buffer.alloc(4);
    await handle.read(offsetBuffer, 0, offsetBuffer.length, 0x3c);
    const peOffset = offsetBuffer.readUInt32LE(0);
    const header = Buffer.alloc(6);
    await handle.read(header, 0, header.length, peOffset);
    assert(header.subarray(0, 4).equals(Buffer.from("PE\0\0")), "Missing PE signature");
    return header.readUInt16LE(4);
  } finally {
    await handle.close();
  }
};

await Promise.all([access(executablePath), access(asarPath), access(ninecliPath)]);
assert((await readPeMachine(executablePath)) === 0x8664, "Windows executable is not x64");
assert((await readPeMachine(ninecliPath)) === 0x8664, "Bundled ninecli executable is not x64");
const ninecliSha256 = await sha256(ninecliPath);
assert(ninecliSha256 === expectedNinecliSha256, "Bundled ninecli binary hash does not match");

const versionResult = await run(
  "pwsh.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "(Get-Item -LiteralPath $env:QIJI_EXE).VersionInfo.ProductVersion",
  ],
  { env: { ...process.env, QIJI_EXE: executablePath } },
);
assert(
  versionResult.stdout.trim().startsWith(packageJson.version),
  "Windows executable version does not match package.json",
);

const signatureResult = await run(
  "pwsh.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "(Get-AuthenticodeSignature -LiteralPath $env:QIJI_EXE).Status",
  ],
  { env: { ...process.env, QIJI_EXE: executablePath } },
);
assert(signatureResult.stdout.trim() === "NotSigned", "Unexpected Windows signature state");

const asarFiles = listPackage(asarPath).map((path) => path.replaceAll("\\", "/"));
for (const requiredFile of [
  "/package.json",
  "/THIRD_PARTY_NOTICES.md",
  "/out/main/index.js",
  "/out/preload/index.cjs",
  "/out/renderer/index.html",
  "/out/renderer/recovery.html",
  "/out/renderer/recovery.js",
]) {
  assert(asarFiles.includes(requiredFile), `Packaged ASAR is missing ${requiredFile}`);
}
const forbiddenPattern =
  /(^|\/)(\.env(?:\.|$)|tokens\.json$|vehicles\.json$|config\.json$|ninecli(?:\.exe)?$)/i;
assert(
  !asarFiles.some((path) => forbiddenPattern.test(path)),
  "Packaged ASAR contains credentials, local config, or a ninecli binary",
);

const expectedFuseStates = [48, 49, 48, 48, 49, 49, 48, 48];
const fuseWire = await getCurrentFuseWire(executablePath);
assert(
  expectedFuseStates.every((state, index) => fuseWire[index] === state),
  `Unexpected Electron fuse state: ${JSON.stringify(fuseWire)}`,
);

const summary = {
  app: appDirectory,
  architecture: "x64",
  version: packageJson.version,
  signature: "unsigned",
  asarFiles: asarFiles.length,
  fuses: "hardened",
  bundledNinecli: {
    architecture: "x64",
    sha256: ninecliSha256,
    verified: true,
  },
  thirdPartyNotices: true,
};

if (verifyArtifacts) {
  const artifacts = [
    resolve(projectRoot, `release/ninebot-desktop-${packageJson.version}-win-x64.exe`),
    resolve(projectRoot, `release/ninebot-desktop-${packageJson.version}-win-x64.zip`),
  ];
  await Promise.all(artifacts.map((path) => access(path)));
  await run("tar.exe", ["-tf", artifacts[1]]);
  const checksums = await Promise.all(
    artifacts.map(async (path) => `${await sha256(path)}  ${path.split(/[\\/]/).at(-1)}`),
  );
  await writeFile(
    resolve(projectRoot, "release/SHA256SUMS-windows.txt"),
    `${checksums.join("\n")}\n`,
  );
  summary.artifacts = artifacts;
  summary.artifactIntegrity = "verified";
  summary.checksums = resolve(projectRoot, "release/SHA256SUMS-windows.txt");
}

console.log(JSON.stringify(summary, null, 2));
