import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { unzipSync } from "fflate";

const projectRoot = resolve(import.meta.dirname, "..");
const runtimeDirectory = resolve(projectRoot, "build/generated/runtime/ninecli");

const runtimeArtifacts = {
  "darwin-arm64": {
    binaryName: "ninecli",
    binarySha256: "2d8aef91a74275528c995217fc7a56e5e2507d069acbd28f340e0aa573908f0a",
    wheelEntry: "ninecli/bin/ninecli",
    wheelSha256: "ab3276dc7ae7675806ed21efc68b1f8ce01a233d6236bb67c82291037a564534",
    wheelUrl:
      "https://files.pythonhosted.org/packages/da/22/d648e0c96d8fe4b1cffe0d7c86c3e35e06e1b948756956e290fe8313c2f1/ninecli-0.1.7-py3-none-macosx_11_0_arm64.whl",
  },
  "win32-x64": {
    binaryName: "ninecli.exe",
    binarySha256: "94338e423b1d5219a2f6bfeda9af34271b83814ef725220c2598676ac18d650e",
    wheelEntry: "ninecli/bin/ninecli.exe",
    wheelSha256: "7fc00300bb5b02f431830912b3bdfb1c77b2a423e7686e01ebaeaab6252ae683",
    wheelUrl:
      "https://files.pythonhosted.org/packages/b8/8d/42fe5fd17f93c3bda63fb41471afc05462b95651d401f5db4903e0b5243e/ninecli-0.1.7-py3-none-win_amd64.whl",
  },
};

const readArgument = (name, fallback) => {
  const prefix = `--${name}=`;
  return (
    process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback
  );
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const platform = readArgument("platform", process.platform);
const architecture = readArgument("arch", process.arch);
const target = `${platform}-${architecture}`;
const artifact = runtimeArtifacts[target];

if (!artifact) {
  throw new Error(`Unsupported bundled ninecli runtime target: ${target}`);
}

await mkdir(runtimeDirectory, { recursive: true });
const outputPath = resolve(runtimeDirectory, artifact.binaryName);
const otherPlatformPath = resolve(
  runtimeDirectory,
  artifact.binaryName === "ninecli" ? "ninecli.exe" : "ninecli",
);
await rm(otherPlatformPath, { force: true });

let existingBinary;
try {
  existingBinary = await readFile(outputPath);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

if (existingBinary && sha256(existingBinary) === artifact.binarySha256) {
  if (platform !== "win32") await chmod(outputPath, 0o755);
  console.log(JSON.stringify({ target, outputPath, source: "verified-cache" }));
  process.exit(0);
}

const response = await fetch(artifact.wheelUrl, { redirect: "error" });
if (!response.ok) {
  throw new Error(`Unable to download pinned ninecli wheel: HTTP ${response.status}`);
}

const wheel = Buffer.from(await response.arrayBuffer());
const actualWheelSha256 = sha256(wheel);
if (actualWheelSha256 !== artifact.wheelSha256) {
  throw new Error(
    `Pinned ninecli wheel failed integrity verification: expected ${artifact.wheelSha256}, received ${actualWheelSha256}`,
  );
}

const files = unzipSync(new Uint8Array(wheel), {
  filter: (entry) => entry.name === artifact.wheelEntry,
});
const binary = files[artifact.wheelEntry];
if (!binary) throw new Error(`Pinned ninecli wheel is missing ${artifact.wheelEntry}`);

const actualBinarySha256 = sha256(binary);
if (actualBinarySha256 !== artifact.binarySha256) {
  throw new Error(
    `Extracted ninecli binary failed integrity verification: expected ${artifact.binarySha256}, received ${actualBinarySha256}`,
  );
}

const temporaryPath = `${outputPath}.${process.pid}.tmp`;
await writeFile(temporaryPath, binary, { mode: 0o755 });
if (platform !== "win32") await chmod(temporaryPath, 0o755);
await rm(outputPath, { force: true });
await rename(temporaryPath, outputPath);

console.log(
  JSON.stringify({
    target,
    outputPath,
    source: "download",
    wheelSha256: actualWheelSha256,
    binarySha256: actualBinarySha256,
  }),
);
