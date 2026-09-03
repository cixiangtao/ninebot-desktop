import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { compareNinebotPayloads } from "../packages/ninebot-client/src/parity-node.ts";
import {
  buildVehicleBatteryFields,
  buildVehicleStatusFields,
  createNinebotTelemetryCandidateClient,
  NinebotTelemetryBusinessError,
} from "../packages/ninebot-client/src/telemetry-node.ts";
import { createFetchNinebotTransport } from "../packages/ninebot-client/src/transport.ts";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");

const printUsage = () => {
  console.log(`Usage: NINEBOT_CONFIG_DIR=<authenticated-config> pnpm protocol:parity -- [options]

Options:
  --vehicle-index=<number>  Zero-based cached vehicle index (default: 0).
  --rounds=<number>         Number of sequential samples, from 1 to 20 (default: 3).
  --service=<ebike|motor>   Override the cached vehicle business line.
  --help                    Show this help.

The report contains only parity metadata, paths, kinds, and lengths. Credentials,
vehicle serials, coordinates, and response bodies never appear in the output.`);
};

const argumentsList = process.argv.slice(2).filter((argument) => argument !== "--");
if (argumentsList.includes("--help")) {
  printUsage();
  process.exit(0);
}

const readNamedArgument = (name: string) => {
  const prefix = `--${name}=`;
  return argumentsList.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};

const unknownArguments = argumentsList.filter(
  (argument) =>
    !argument.startsWith("--vehicle-index=") &&
    !argument.startsWith("--rounds=") &&
    !argument.startsWith("--service="),
);
if (unknownArguments.length > 0) {
  throw new Error(`Unknown protocol parity argument: ${unknownArguments[0]}`);
}

const configDirectory = process.env.NINEBOT_CONFIG_DIR;
if (!configDirectory)
  throw new Error("NINEBOT_CONFIG_DIR must point to an authenticated ninecli config");

const parseBoundedInteger = (value: string | undefined, label: string, maximum: number) => {
  const parsed = Number(value ?? "");
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`${label} must be an integer from 0 to ${maximum}`);
  }
  return parsed;
};

const vehicleIndex = parseBoundedInteger(readNamedArgument("vehicle-index"), "vehicle-index", 99);
const rounds = parseBoundedInteger(readNamedArgument("rounds"), "rounds", 20);
if (rounds < 1) throw new Error("rounds must be at least 1");

const requestedService = readNamedArgument("service");
if (
  requestedService !== undefined &&
  requestedService !== "ebike" &&
  requestedService !== "motor"
) {
  throw new Error("service must be ebike or motor");
}

const [config, tokens, vehicleCache] = await Promise.all([
  readFile(join(configDirectory, "config.json"), "utf8").then(JSON.parse),
  readFile(join(configDirectory, "tokens.json"), "utf8").then(JSON.parse),
  readFile(join(configDirectory, "vehicles.json"), "utf8").then(JSON.parse),
]);
const vehicle = vehicleCache.vehicles?.[vehicleIndex];
if (!vehicle || typeof vehicle.wnumber !== "string" || vehicle.wnumber.length === 0) {
  throw new Error(`No cached vehicle at index ${vehicleIndex}`);
}
const service = requestedService ?? vehicle.business_line;
if (service !== "ebike" && service !== "motor") {
  throw new Error(
    "Cached vehicle business_line must be ebike or motor; pass --service to override",
  );
}
if (typeof tokens.access_token !== "string" || typeof tokens.business_uid !== "string") {
  throw new Error("Authenticated ninecli tokens are incomplete");
}

const session = {
  sys_language: "zh-hans-cn",
  client_ver: "610063322",
  device_id: config.device_id,
  regionx: config.region,
  language: "zh",
  ostype: "and",
  lang: "zh",
  platform_ver: `${config.os_version} ${config.os_model}`,
  platform: "android",
  login_country: "CN",
  access_token: tokens.access_token,
  uid: tokens.business_uid,
};
const origins =
  service === "ebike"
    ? { ebike: "https://ebike.ninebot.com" }
    : { motor: "https://steeldust.ninebot.com" };
const candidate = createNinebotTelemetryCandidateClient({
  transport: createFetchNinebotTransport({ origins }),
  platform: 2,
});
const ninecliBinary = join(
  projectRoot,
  "build/generated/runtime/ninecli",
  process.platform === "win32" ? "ninecli.exe" : "ninecli",
);

const runOracle = async (command: "status" | "battery") => {
  const result = await execFileAsync(
    ninecliBinary,
    ["--config", configDirectory, "--json", command, vehicle.wnumber],
    { env: { ...process.env, NINEBOT_CONFIG_DIR: configDirectory }, maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(result.stdout) as unknown;
};

const summarizeError = (error: unknown) => {
  if (error instanceof NinebotTelemetryBusinessError) {
    return { type: error.name, code: error.code, dataKind: error.dataKind };
  }
  return { type: error instanceof Error ? error.name : "UnknownError" };
};

const summarizeReport = (report: ReturnType<typeof compareNinebotPayloads>) => ({
  equal: report.equal,
  comparedNodes: report.comparedNodes,
  truncated: report.truncated,
  differenceCount: report.differences.length,
  differences: report.differences,
});

const samples = [];
for (let index = 0; index < rounds; index += 1) {
  const sample: Record<string, unknown> = { index: index + 1 };
  try {
    // Keep rounds sequential to avoid bursting the upstream with duplicate telemetry reads.
    // eslint-disable-next-line no-await-in-loop
    const [oracleStatus, oracleBattery] = await Promise.all([
      runOracle("status"),
      runOracle("battery"),
    ]);
    // eslint-disable-next-line no-await-in-loop
    const [candidateStatus, candidateBattery] = await Promise.all([
      candidate.status({
        service,
        fields: buildVehicleStatusFields({ session, sn_str: vehicle.wnumber }),
      }),
      candidate.battery({
        service,
        fields: buildVehicleBatteryFields({ session, wnumber: vehicle.wnumber }),
      }),
    ]);
    sample.status = summarizeReport(compareNinebotPayloads(oracleStatus, candidateStatus.data[0]));
    sample.battery = summarizeReport(compareNinebotPayloads(oracleBattery, candidateBattery.data));
  } catch (error) {
    sample.error = summarizeError(error);
  }
  samples.push(sample);
}

const successfulSamples = samples.filter(
  (
    sample,
  ): sample is {
    status: ReturnType<typeof summarizeReport>;
    battery: ReturnType<typeof summarizeReport>;
  } => "status" in sample && "battery" in sample,
);
const allEqual =
  successfulSamples.length === rounds &&
  successfulSamples.every((sample) => sample.status.equal && sample.battery.equal);
console.log(
  JSON.stringify(
    {
      configDirectoryName: basename(configDirectory),
      vehicleIndex,
      service,
      requestedRounds: rounds,
      samples,
      allEqual,
    },
    null,
    2,
  ),
);
if (!allEqual) process.exitCode = 1;
