import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

if (process.platform !== "win32") {
  throw new Error("Windows installer QA must run on Windows");
}

const run = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const installerPath = resolve(projectRoot, `release/qiji-${packageJson.version}-win-x64.exe`);
const qaRoot = await mkdtemp(join(tmpdir(), "qiji-windows-installer-qa-"));
const installDirectory = join(qaRoot, "installed");
const installedExecutable = join(installDirectory, "骑迹.exe");

const waitForRemoval = async (path) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await access(path);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`Timed out waiting for uninstaller to remove ${path}`);
};

try {
  await access(installerPath);
  await run(installerPath, ["/S", `/D=${installDirectory}`], { timeout: 120_000 });
  await access(installedExecutable);

  const smoke = await run(process.execPath, [resolve(projectRoot, "scripts/qa-packaged.mjs")], {
    cwd: projectRoot,
    env: { ...process.env, QIJI_EXECUTABLE_PATH: installedExecutable },
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  process.stdout.write(smoke.stdout);
  process.stderr.write(smoke.stderr);

  const uninstallerName = (await readdir(installDirectory)).find(
    (name) => name.startsWith("Uninstall ") && name.endsWith(".exe"),
  );
  if (!uninstallerName) throw new Error("Installed package is missing its uninstaller");
  await run(join(installDirectory, uninstallerName), ["/S"], { timeout: 120_000 });
  await waitForRemoval(installedExecutable);

  console.log(
    JSON.stringify({
      installer: installerPath,
      installedExecutable,
      silentInstall: true,
      installedLaunch: true,
      uninstallerPresent: true,
      silentUninstall: true,
    }),
  );
} finally {
  await rm(qaRoot, { recursive: true, force: true });
}
