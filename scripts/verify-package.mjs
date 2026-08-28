import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const run = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const appPath = resolve(projectRoot, "release/mac-arm64/骑迹.app");
const executablePath = resolve(appPath, "Contents/MacOS/骑迹");
const resourcesPath = resolve(appPath, "Contents/Resources");
const asarPath = resolve(resourcesPath, "app.asar");
const verifyArtifacts = process.argv.includes("--artifacts") || process.argv.includes("--release");
const verifyRelease = process.argv.includes("--release");

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

const readPlistValue = async (key) => {
  const { stdout } = await run("/usr/libexec/PlistBuddy", [
    "-c",
    `Print :${key}`,
    resolve(appPath, "Contents/Info.plist"),
  ]);
  return stdout.trim();
};

const sha256 = (path) =>
  new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });

await Promise.all([access(executablePath), access(asarPath)]);
assert((await readPlistValue("CFBundleIdentifier")) === "dev.anys.qiji", "Unexpected bundle ID");
assert((await readPlistValue("CFBundleName")) === "骑迹", "Unexpected bundle name");
assert(
  (await readPlistValue("CFBundleShortVersionString")) === packageJson.version,
  "Bundle version does not match package.json",
);

const asarFiles = listPackage(asarPath);
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
const fuseWire = await getCurrentFuseWire(appPath);
assert(
  expectedFuseStates.every((state, index) => fuseWire[index] === state),
  `Unexpected Electron fuse state: ${JSON.stringify(fuseWire)}`,
);

await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath]);
const signature = await run("/usr/bin/codesign", ["-dv", "--verbose=4", appPath]).catch(
  ({ stdout = "", stderr = "" }) => ({ stdout, stderr }),
);
const signatureDetails = `${signature.stdout}${signature.stderr}`;
if (verifyRelease) {
  assert(
    /Authority=Developer ID Application:/.test(signatureDetails),
    "Release is not signed with a Developer ID Application certificate",
  );
  await run("/usr/sbin/spctl", ["--assess", "--verbose", "--type", "exec", appPath]);
  await run("/usr/bin/xcrun", ["stapler", "validate", appPath]);
}

const summary = {
  app: appPath,
  architecture: (await run("/usr/bin/file", [executablePath])).stdout.trim(),
  bundleId: await readPlistValue("CFBundleIdentifier"),
  version: packageJson.version,
  signature: /Authority=Developer ID Application:/.test(signatureDetails)
    ? "developer-id"
    : /Signature=adhoc/.test(signatureDetails)
      ? "ad-hoc"
      : "unknown",
  asarFiles: asarFiles.length,
  fuses: "hardened",
  bundledNinecli: false,
  thirdPartyNotices: true,
};

if (verifyArtifacts) {
  const artifacts = [
    resolve(projectRoot, `release/qiji-${packageJson.version}-mac-arm64.dmg`),
    resolve(projectRoot, `release/qiji-${packageJson.version}-mac-arm64.zip`),
  ];
  await Promise.all(artifacts.map((path) => access(path)));
  await Promise.all([
    run("/usr/bin/hdiutil", ["verify", artifacts[0]]),
    run("/usr/bin/unzip", ["-tqq", artifacts[1]]),
  ]);
  const checksums = await Promise.all(
    artifacts.map(async (path) => `${await sha256(path)}  ${path.split("/").at(-1)}`),
  );
  await writeFile(resolve(projectRoot, "release/SHA256SUMS.txt"), `${checksums.join("\n")}\n`);
  summary.artifacts = artifacts;
  summary.artifactIntegrity = "verified";
  summary.checksums = resolve(projectRoot, "release/SHA256SUMS.txt");
}

console.log(JSON.stringify(summary, null, 2));
