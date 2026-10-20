import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import type { NinebotPasswordCredentials, NinebotCandidateService } from "@jiuhao/ninebot-client";
import { runNinebotAuthAcceptance } from "./auth-acceptance-core.ts";

const usage = `Usage: pnpm protocol:auth -- [options]

  --service=ebike|motor   Service family to validate (default: ebike).
  --vehicle-index=N      Zero-based index in the discovered vehicle list (default: 0).
  --month=YYYYMM         Month containing a ride (default: previous calendar month).
  --auth-only           Validate login/Business/profile/restore/refresh/logout without vehicle reads.
  --credentials-stdin    Read {"user","password","areaCode"} JSON from stdin instead of TTY prompts.
  --help                 Show this help without reading credentials or contacting Ninebot.

Creates a fresh private temporary directory; never reads an existing account configuration.
Runs real password login, profile, restore, refresh, vehicle/status/battery/month/detail reads,
then local logout. With --auth-only, no vehicle/status/battery/month/detail reads occur. Removes the temporary directory on normal completion or handled failure.
Only stage results and counts are printed. No retries or ninecli fallback.
Exit codes: 0 passed, 1 failed, 2 incomplete (no vehicle or no ride).
`;

/** Parses only explicit non-secret options; credential arguments are intentionally rejected. */
export const parseAuthAcceptanceArguments = (args: string[], now = new Date()) => {
  let service: NinebotCandidateService = "ebike";
  let vehicleIndex = 0;
  const previous = new Date(now);
  previous.setDate(1);
  previous.setMonth(previous.getMonth() - 1);
  let month = `${previous.getFullYear()}${String(previous.getMonth() + 1).padStart(2, "0")}`;
  let credentialsStdin = false;
  let authOnly = false;
  const seen = new Set<string>();
  for (const arg of args.filter((value) => value !== "--")) {
    const name = arg.split("=")[0]!;
    if (seen.has(name)) throw new Error("Duplicate acceptance option");
    seen.add(name);
    if (arg === "--auth-only") authOnly = true;
    else if (arg === "--credentials-stdin") credentialsStdin = true;
    else if (arg === "--service=ebike") service = "ebike";
    else if (arg === "--service=motor") service = "motor";
    else if (arg.startsWith("--month=")) month = arg.slice("--month=".length);
    else if (/^--vehicle-index=\d+$/.test(arg))
      vehicleIndex = Number(arg.slice("--vehicle-index=".length));
    else throw new Error("Unsupported acceptance option");
  }
  if (
    !/^\d{4}(0[1-9]|1[0-2])$/.test(month) ||
    !Number.isSafeInteger(vehicleIndex) ||
    vehicleIndex > 999
  )
    throw new Error("Invalid acceptance option");
  return { service, month, vehicleIndex, credentialsStdin, authOnly };
};

/** Validates input without ever including the rejected value in an error. */
export const parseAuthAcceptanceCredentials = (value: unknown): NinebotPasswordCredentials => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid credentials input");
  const record = value as Record<string, unknown>;
  const { user, password } = record;
  const areaCode = record.areaCode ?? "86";
  if (
    typeof user !== "string" ||
    !user.trim() ||
    typeof password !== "string" ||
    !password ||
    typeof areaCode !== "string" ||
    !/^\+?\d{1,4}$/.test(areaCode)
  )
    throw new Error("Invalid credentials input");
  return { user: user.trim(), password, areaCode };
};

const readCredentials = async (fromStdin: boolean) => {
  if (fromStdin) {
    let body = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      body += String(chunk);
      if (body.length > 16_384) throw new Error("Credentials input too large");
    }
    return parseAuthAcceptanceCredentials(JSON.parse(body) as unknown);
  }
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new Error("Interactive terminal required");
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stderr.write(chunk, encoding);
      callback();
    },
  });
  const prompt = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  const controller = new AbortController();
  prompt.on("SIGINT", () => controller.abort());
  prompt.on("close", () => controller.abort());
  try {
    const user = await prompt.question("九号账号：", { signal: controller.signal });
    const areaCode = await prompt.question("国家区号（默认 86）：", { signal: controller.signal });
    process.stderr.write("密码（不回显）：");
    muted = true;
    const password = await prompt.question("", { signal: controller.signal });
    return parseAuthAcceptanceCredentials({ user, areaCode: areaCode.trim() || "86", password });
  } finally {
    prompt.close();
    output.end();
    process.stderr.write("\n");
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(usage);
    return;
  }
  let directory: string | undefined;
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  let phase: "options" | "credentials" | "setup" | "run" = "options";
  try {
    const options = parseAuthAcceptanceArguments(args);
    phase = "credentials";
    const credentials = await readCredentials(options.credentialsStdin);
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", interrupt);
    phase = "setup";
    directory = await mkdtemp(join(tmpdir(), "ninebot-auth-acceptance-"));
    phase = "run";
    const report = await runNinebotAuthAcceptance({
      ...options,
      directory,
      credentials,
      signal: controller.signal,
    });
    // Delete private artifacts before reporting success, so cleanup failure fails the command.
    await rm(directory, { recursive: true, force: true });
    directory = undefined;
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.outcome === "passed" ? 0 : report.outcome === "incomplete" ? 2 : 1;
  } catch {
    // Upstream error messages, names and stack traces may contain private data.
    console.log(JSON.stringify({ outcome: "failed", phase, reason: "acceptance-failed" }));
    process.exitCode = 1;
  } finally {
    if (directory !== undefined) {
      try {
        await rm(directory, { recursive: true, force: true });
      } catch {
        console.error("Private acceptance directory cleanup failed");
        process.exitCode = 1;
      }
    }
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
