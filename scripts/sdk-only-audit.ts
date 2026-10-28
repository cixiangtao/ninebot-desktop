import { execFileSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export const forbiddenSdkPath = (path: string) =>
  /(^|\/)(ninecli(?:\.exe)?(?:\/|$)|\.env(?:\.|$)|(?:auth-session|tokens|vehicles|config)\.json$|vehicle-cache\.json(?:\.|$))/i.test(
    path.replaceAll("\\", "/"),
  );
const legacyExecution =
  /(?:node:)?child_process|NineCliClient|getBundledNineCliBinaryPath|prepare-ninecli-runtime/;
export const assertSdkOnlyArchive = (
  files: string[],
  metadata: Record<string, unknown>,
  main: string,
) => {
  assert(metadata.ninebotRuntime === "sdk-only", "Missing SDK-only package identity");
  assert(metadata.main === "./out/main/index.js", "Unexpected packaged main entry");
  for (const file of [
    "/package.json",
    "/THIRD_PARTY_NOTICES.md",
    "/out/main/index.js",
    "/out/preload/index.cjs",
    "/out/preload/sms-verification.cjs",
    "/out/renderer/index.html",
    "/out/renderer/recovery.html",
    "/out/renderer/recovery.js",
    "/node_modules/@jiuhao/ninebot-client/dist/index.js",
  ])
    assert(files.includes(file), `SDK package is missing ${file}`);
  assert(
    !files.some(forbiddenSdkPath),
    "SDK package contains legacy runtime or local session data",
  );
  assert(main.includes("sdk-only-v1"), "Main bundle is not the SDK-only entry");
  assert(
    !legacyExecution.test(main),
    "SDK main bundle contains a subprocess or legacy execution path",
  );
};
export const asarTools = (root: string) => {
  const require = createRequire(join(root, "package.json"));
  const builder = require.resolve("electron-builder");
  const appBuilder = require.resolve("app-builder-lib", { paths: [dirname(builder)] });
  const paths = [dirname(appBuilder)];
  const asar = require(require.resolve("@electron/asar", { paths })) as {
    listPackage: (path: string) => string[];
    extractFile: (path: string, file: string) => Buffer;
    extractAll: (path: string, destination: string) => void;
  };
  const fuses = require(require.resolve("@electron/fuses", { paths })) as {
    getCurrentFuseWire: (path: string) => Promise<number[]>;
  };
  return { ...asar, ...fuses };
};
const resourceFiles = async (root: string): Promise<string[]> => {
  const children = await readdir(root, { withFileTypes: true });
  const results = await Promise.all(
    children.map(async (child) => {
      const path = join(root, child.name);
      assert(!child.isSymbolicLink(), "External SDK resource symlink is not allowed");
      return child.isDirectory() ? resourceFiles(path) : [path];
    }),
  );
  return results.flat();
};

/** Audits the actual artifact, including unpacked resources and unchanged fuse policy. */
export const verifySdkOnlyPackage = async (
  root: string,
  app: string,
  platform: "darwin" | "win32",
) => {
  assert(platform === process.platform, "Native package verification requires the target OS");
  const resources = join(app, platform === "darwin" ? "Contents/Resources" : "resources");
  const executable = join(app, platform === "darwin" ? "Contents/MacOS/韭号出行" : "韭号出行.exe");
  const archive = join(resources, "app.asar");
  await Promise.all([access(executable), access(archive)]);
  const tools = asarTools(root);
  const files = tools.listPackage(archive).map((file) => file.replaceAll("\\", "/"));
  const metadata = JSON.parse(
    tools.extractFile(archive, "package.json").toString("utf8"),
  ) as Record<string, unknown>;
  assertSdkOnlyArchive(
    files,
    metadata,
    tools.extractFile(archive, "out/main/index.js").toString("utf8"),
  );
  assert(
    !(await resourceFiles(resources)).some(forbiddenSdkPath),
    "External resources contain legacy runtime or session data",
  );
  // SDK dependencies are externalized, so audit their code as well as the main bundle.
  for (const file of files.filter(
    (entry) => entry.startsWith("/node_modules/@jiuhao/ninebot-client/") && entry.endsWith(".js"),
  )) {
    assert(
      !legacyExecution.test(tools.extractFile(archive, file.slice(1)).toString("utf8")),
      "SDK dependency contains a legacy execution path",
    );
  }
  const wire = await tools.getCurrentFuseWire(platform === "darwin" ? app : executable);
  assert(
    [48, 49, 48, 48, 49, 49, 48, 48].every((state, index) => wire[index] === state),
    "SDK package fuse policy changed",
  );
  const version = (
    JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string }
  ).version;
  assert(metadata.version === version, "SDK ASAR version mismatch");
  if (platform === "darwin") {
    const plist = (key: string) =>
      execFileSync(
        "/usr/libexec/PlistBuddy",
        ["-c", `Print :${key}`, join(app, "Contents/Info.plist")],
        { encoding: "utf8" },
      ).trim();
    assert(plist("CFBundleIdentifier") === "dev.anys.ninebot-desktop", "SDK bundle ID mismatch");
    assert(plist("CFBundleShortVersionString") === version, "SDK native version mismatch");
    assert(
      execFileSync("/usr/bin/file", [executable], { encoding: "utf8" }).includes("arm64"),
      "SDK native architecture mismatch",
    );
    execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], { stdio: "pipe" });
  } else {
    const bytes = await readFile(executable);
    const offset = bytes.readUInt32LE(0x3c);
    assert(
      bytes.subarray(offset, offset + 4).equals(Buffer.from("PE\0\0")) &&
        bytes.readUInt16LE(offset + 4) === 0x8664,
      "SDK Windows executable is not PE x64",
    );
  }
  return {
    app: resolve(app),
    runtime: "sdk-only",
    version,
    bundledNinecli: false,
    legacyExecutionPath: false,
    archiveFiles: files.length,
    fuses: "hardened",
    nativeVerification: platform,
    published: false,
  };
};
