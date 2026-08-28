import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, rm, stat } from "node:fs/promises";
import { basename, delimiter, join } from "node:path";

export const ninecliVersion = "0.1.7";
const commandTimeoutMs = 45_000;
const maxOutputLength = 12 * 1024 * 1024;

const allowedCommands = [
  "battery",
  "login",
  "login-code",
  "status",
  "travel",
  "vehicles",
  "whoami",
] as const;
type AllowedCommand = (typeof allowedCommands)[number];

const expectedBinaryHashes: Readonly<Record<string, string>> = {
  "darwin-arm64": "2d8aef91a74275528c995217fc7a56e5e2507d069acbd28f340e0aa573908f0a",
};

const environmentKeys = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "all_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "UV_CACHE_DIR",
  "XDG_CACHE_HOME",
] as const;

const tokenFiles = ["tokens.json", "vehicles.json"] as const;
const restrictedFiles = ["config.json", ...tokenFiles] as const;

export interface RuntimeSecurityStatus {
  version: string;
  binary: {
    status: "verified" | "mismatch" | "unsupported" | "unavailable";
    sha256: string | null;
    expectedSha256: string | null;
    platform: NodeJS.Platform;
    architecture: string;
  };
  storage: {
    directoryName: string;
    tokensPresent: boolean;
    permissions: "restricted" | "needs-attention" | "unavailable";
  };
  policy: {
    allowedCommands: readonly AllowedCommand[];
    environment: "minimal";
    passwordTransport: "process-arguments";
    smsCodeTransport: "process-arguments";
    vehicleControlsExposed: false;
    sessionCache: {
      storage: "memory-only";
      rawResponsesStored: false;
      persistsAcrossRestarts: false;
      manualRefreshBypasses: true;
    };
  };
}

export const runtimePolicy = {
  allowedCommands,
  environment: "minimal",
  passwordTransport: "process-arguments",
  smsCodeTransport: "process-arguments",
  vehicleControlsExposed: false,
  sessionCache: {
    storage: "memory-only",
    rawResponsesStored: false,
    persistsAcrossRestarts: false,
    manualRefreshBypasses: true,
  },
} as const satisfies RuntimeSecurityStatus["policy"];

export class NineCliError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "missing"
      | "auth"
      | "verification"
      | "integrity"
      | "unsupported"
      | "upstream" = "upstream",
  ) {
    super(message);
    this.name = "NineCliError";
  }
}

export const createNineCliEnvironment = (
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv =>
  Object.fromEntries(
    environmentKeys.flatMap((key) => {
      const value = source[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );

export const getExpectedBinarySha256 = (
  platform: NodeJS.Platform = process.platform,
  architecture = process.arch,
) => expectedBinaryHashes[`${platform}-${architecture}`] ?? null;

export const isAllowedNineCliCommand = (command: string): command is AllowedCommand =>
  allowedCommands.includes(command as AllowedCommand);

/** Maps known ninecli failures to stable, renderer-safe application errors. */
export const classifyNineCliFailure = (stdout: string, stderr: string) => {
  const output = `${stderr}\n${stdout}`;
  if (/resultCode[=:]90202|send code need verify|captcha|yidun|NECaptcha/i.test(output)) {
    return new NineCliError(
      "九号要求先完成人机验证；ninecli 0.1.7 暂不支持该验证，请改用密码登录。",
      "verification",
    );
  }
  if (/login|token|auth|unauthorized|expired/i.test(output)) {
    return new NineCliError("登录状态无效，请重新连接九号账号。", "auth");
  }
  return new NineCliError("ninecli 请求失败，请稍后重试。", "upstream");
};

const getUvxCandidates = (source: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] => {
  const executableName = platform === "win32" ? "uvx.exe" : "uvx";
  const pathCandidates = (source.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, executableName));
  const homeCandidates = source.HOME
    ? [
        join(source.HOME, ".local", "bin", executableName),
        join(source.HOME, ".cargo", "bin", executableName),
      ]
    : [];
  const systemCandidates =
    platform === "darwin"
      ? [join("/opt/homebrew/bin", executableName), join("/usr/local/bin", executableName)]
      : [];

  return [...new Set([...pathCandidates, ...homeCandidates, ...systemCandidates])];
};

/**
 * Locates uvx even when Electron was opened from Finder with a minimal PATH.
 *
 * @returns An absolute executable path, or null when uv is not installed in a known location.
 */
export const resolveUvxExecutable = async (
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
) => {
  const candidates = getUvxCandidates(source, platform);
  const executableCandidates = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        return null;
      }
    }),
  );
  return executableCandidates.find((candidate) => candidate !== null) ?? null;
};

const collectProcess = (
  executable: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  missingMessage: string,
) =>
  new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn(executable, args, {
      env: environment,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = <T>(callback: () => T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new NineCliError("九号服务响应超时，请检查网络后重试。")));
    }, commandTimeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-maxOutputLength);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-maxOutputLength);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(() =>
        reject(
          error.code === "ENOENT"
            ? new NineCliError(missingMessage, "missing")
            : new NineCliError("无法启动本地 ninecli。"),
        ),
      );
    });
    child.on("close", (code) => {
      finish(() => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code }));
    });
  });

/** Narrow adapter around a fixed, integrity-checked subset of ninecli. */
export class NineCliClient {
  private binaryPathPromise: Promise<string> | null = null;

  constructor(private readonly configDirectory: string) {}

  async login(user: string, areaCode: string, password: string) {
    await this.run("login", ["--area", areaCode, "--user", user, "--password", password], false);
  }

  async requestSmsCode(phone: string, areaCode: string) {
    await this.run("login-code", ["--area", areaCode, "--phone", phone], false);
  }

  async loginWithSmsCode(phone: string, areaCode: string, code: string) {
    await this.run("login-code", ["--area", areaCode, "--phone", phone, "--code", code], false);
  }

  async logout() {
    await this.prepareConfigDirectory();
    await Promise.all(
      tokenFiles.map((file) => rm(join(this.configDirectory, file), { force: true })),
    );
  }

  async whoami() {
    return this.runJson("whoami");
  }

  async vehicles() {
    return this.runJson("vehicles");
  }

  async vehicleStatus(serialNumber: string) {
    return this.runJson("status", [serialNumber]);
  }

  async battery(serialNumber: string) {
    return this.runJson("battery", [serialNumber]);
  }

  async rides(serialNumber: string, month: string) {
    return this.runJson("travel", [serialNumber, "--month", month]);
  }

  async rideDetail(serialNumber: string, travelId: string) {
    return this.runJson("travel", [serialNumber, "--detail", travelId]);
  }

  async diagnostics(): Promise<RuntimeSecurityStatus> {
    await this.prepareConfigDirectory();
    const expectedSha256 = getExpectedBinarySha256();
    let sha256: string | null = null;
    let binaryStatus: RuntimeSecurityStatus["binary"]["status"] = expectedSha256
      ? "unavailable"
      : "unsupported";

    if (expectedSha256) {
      try {
        const binaryPath = await this.resolvePackagedBinaryPath();
        sha256 = await this.hashFile(binaryPath);
        binaryStatus = sha256 === expectedSha256 ? "verified" : "mismatch";
      } catch {
        binaryStatus = "unavailable";
      }
    }

    return {
      version: ninecliVersion,
      binary: {
        status: binaryStatus,
        sha256,
        expectedSha256,
        platform: process.platform,
        architecture: process.arch,
      },
      storage: {
        directoryName: basename(this.configDirectory),
        tokensPresent: await this.hasTokens(),
        permissions: await this.getStoragePermissions(),
      },
      policy: runtimePolicy,
    };
  }

  private async prepareConfigDirectory() {
    await mkdir(this.configDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.configDirectory, 0o700);
    await Promise.all(
      restrictedFiles.map(async (file) => {
        try {
          await chmod(join(this.configDirectory, file), 0o600);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }),
    );
  }

  private async hasTokens() {
    try {
      await stat(join(this.configDirectory, "tokens.json"));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  private async getStoragePermissions(): Promise<RuntimeSecurityStatus["storage"]["permissions"]> {
    try {
      const directory = await stat(this.configDirectory);
      if ((directory.mode & 0o077) !== 0) return "needs-attention";
      const filePermissions = await Promise.all(
        restrictedFiles.map(async (file) => {
          try {
            const fileStats = await stat(join(this.configDirectory, file));
            return (fileStats.mode & 0o077) === 0;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
            throw error;
          }
        }),
      );
      return filePermissions.every(Boolean) ? "restricted" : "needs-attention";
    } catch {
      return "unavailable";
    }
  }

  private async resolveVerifiedBinaryPath() {
    const expectedSha256 = getExpectedBinarySha256();
    if (!expectedSha256) {
      throw new NineCliError(
        `当前平台 ${process.platform}-${process.arch} 尚未建立 ninecli 二进制校验基线。`,
        "unsupported",
      );
    }
    const binaryPath = await this.resolvePackagedBinaryPath();
    const actualSha256 = await this.hashFile(binaryPath);
    if (actualSha256 !== expectedSha256) {
      this.binaryPathPromise = null;
      throw new NineCliError("ninecli 二进制完整性校验失败，已阻止执行。", "integrity");
    }
    return binaryPath;
  }

  private async resolvePackagedBinaryPath() {
    if (!this.binaryPathPromise) {
      this.binaryPathPromise = this.locatePackagedBinary().catch((error) => {
        this.binaryPathPromise = null;
        throw error;
      });
    }
    return this.binaryPathPromise;
  }

  private async locatePackagedBinary() {
    const binaryName = process.platform === "win32" ? "ninecli.exe" : "ninecli";
    const script = [
      "from importlib.metadata import distribution",
      "from pathlib import Path",
      `print(Path(distribution('ninecli').locate_file('ninecli/bin/${binaryName}')).resolve())`,
    ].join("; ");
    const uvxExecutable = await resolveUvxExecutable();
    if (!uvxExecutable) {
      throw new NineCliError("未找到 uvx，请先安装 uv 后再连接九号账号。", "missing");
    }
    const result = await collectProcess(
      uvxExecutable,
      ["--from", `ninecli==${ninecliVersion}`, "python", "-c", script],
      createNineCliEnvironment(),
      "未找到 uvx，请先安装 uv 后再连接九号账号。",
    );
    if (result.code !== 0 || !result.stdout) {
      throw new NineCliError("无法定位固定版本的 ninecli 二进制。");
    }
    return result.stdout.split(/\r?\n/).at(-1) ?? result.stdout;
  }

  private async hashFile(path: string) {
    const content = await readFile(path);
    return createHash("sha256").update(content).digest("hex");
  }

  private async runJson(command: AllowedCommand, args: string[] = []) {
    const raw = await this.run(command, args, true);
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new NineCliError("ninecli 返回了无法解析的数据，请稍后重试。");
    }
  }

  private async run(command: AllowedCommand, args: string[], json: boolean) {
    if (!isAllowedNineCliCommand(command)) {
      throw new NineCliError("该 ninecli 命令未被应用安全策略允许。", "integrity");
    }
    await this.prepareConfigDirectory();
    const executable = await this.resolveVerifiedBinaryPath();
    const commandArgs = ["--config", this.configDirectory];
    if (json) commandArgs.push("--json");
    commandArgs.push(command, ...args);
    let result: Awaited<ReturnType<typeof collectProcess>>;
    try {
      result = await collectProcess(
        executable,
        commandArgs,
        createNineCliEnvironment(),
        "固定版本的 ninecli 二进制不可用。",
      );
    } finally {
      // Login may create token files, so close their permissions before returning control.
      await this.prepareConfigDirectory();
    }
    if (result.code === 0) return result.stdout;

    throw classifyNineCliFailure(result.stdout, result.stderr);
  }
}
