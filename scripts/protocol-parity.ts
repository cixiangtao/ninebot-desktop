import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { compareNinebotPayloads } from "../packages/ninebot-client/src/parity-node.ts";
import { generateNinebotNonce } from "../packages/ninebot-client/src/crypto-node.ts";
import {
  buildVehicleBatteryFields,
  buildVehicleStatusFields,
  createNinebotTelemetryCandidateClient,
  NinebotTelemetryBusinessError,
} from "../packages/ninebot-client/src/telemetry-node.ts";
import {
  createNinebotTravelCandidateClient,
  type TravelDetailPlaintextFields,
  type TravelMonthPlaintextFields,
} from "../packages/ninebot-client/src/travel-node.ts";
import { createFetchNinebotTransport } from "../packages/ninebot-client/src/transport.ts";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");

const printUsage = () => {
  console.log(`Usage: NINEBOT_CONFIG_DIR=<authenticated-config> pnpm protocol:parity -- [options]

Options:
  --vehicle-index=<number>  Zero-based cached vehicle index (default: 0).
  --rounds=<number>         Number of sequential samples, from 1 to 20 (default: 3).
  --service=<ebike|motor>   Override the cached vehicle business line.
  --month=<YYYYMM>          Travel month to compare (default: previous calendar month).
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
    !argument.startsWith("--service=") &&
    !argument.startsWith("--month="),
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

const requestedMonth = readNamedArgument("month");
const previousMonth = new Date();
previousMonth.setMonth(previousMonth.getMonth() - 1);
const parityMonth =
  requestedMonth ??
  `${previousMonth.getFullYear()}${String(previousMonth.getMonth() + 1).padStart(2, "0")}`;
if (
  !/^\d{6}$/.test(parityMonth) ||
  Number(parityMonth.slice(4)) < 1 ||
  Number(parityMonth.slice(4)) > 12
) {
  throw new Error("month must be a valid YYYYMM value");
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
const travelCandidate = createNinebotTravelCandidateClient({
  transport: createFetchNinebotTransport({
    origins: { travel: "https://cn-cbu-gateway.ninebot.com" },
  }),
  platform: 2,
});
const ninecliBinary = join(
  projectRoot,
  "build/generated/runtime/ninecli",
  process.platform === "win32" ? "ninecli.exe" : "ninecli",
);

const runOracle = async (
  command: "status" | "battery" | "travel" | "vehicles",
  args: string[] = [],
) => {
  const commandArgs = command === "vehicles" ? args : [vehicle.wnumber, ...args];
  const result = await execFileAsync(
    ninecliBinary,
    ["--config", configDirectory, "--json", command, ...commandArgs],
    { env: { ...process.env, NINEBOT_CONFIG_DIR: configDirectory }, maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(result.stdout) as unknown;
};

const vehicleType = async () => {
  const payload = await runOracle("vehicles");
  const rows = Array.isArray(payload) ? payload : [];
  const row = rows.find(
    (item): item is Record<string, unknown> =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      ((item as Record<string, unknown>).wnumber === vehicle.wnumber ||
        (item as Record<string, unknown>).sn === vehicle.wnumber),
  );
  const value = row?.vehicle_type;
  if ((typeof value !== "string" && typeof value !== "number") || String(value).length === 0) {
    throw new Error("ninecli vehicles output has no vehicle_type for the selected vehicle");
  }
  return String(value);
};

const unwrapTravelPayload = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  if (
    record.data !== null &&
    typeof record.data === "object" &&
    !Array.isArray(record.data) &&
    ("code" in record || "desc" in record)
  ) {
    return record.data as Record<string, unknown>;
  }
  return record;
};

const normalizeTravelMonth = (value: unknown) => {
  const record = unwrapTravelPayload(value);
  return {
    detail: record.detail,
    duration: record.duration,
    ec: record.ec,
    first_time: record.first_time,
    list: record.list,
    month: record.month,
    times: record.times,
    total_mileages: record.total_mileages,
  };
};

const normalizeTravelDetail = (value: unknown) => {
  const { code: _code, desc: _desc, ...payload } = unwrapTravelPayload(value);
  return payload;
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

const selectedVehicleType = await vehicleType();
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
    const travelBase = {
      ...session,
      wnumber: vehicle.wnumber,
      rnVersion: "743",
      vehicle_type: selectedVehicleType,
      current_version: "610063322",
      serviceTime: Date.now(),
      nonce: generateNinebotNonce(),
    };
    // eslint-disable-next-line no-await-in-loop
    const oracleMonth = await runOracle("travel", ["--month", parityMonth]);
    // eslint-disable-next-line no-await-in-loop
    const candidateMonth = await travelCandidate.month({
      fields: { ...travelBase, month: parityMonth, page: "1" } as TravelMonthPlaintextFields,
      businessType: service === "motor" ? "1" : "2",
    });
    const travelReport: Record<string, unknown> = {
      month: summarizeReport(
        compareNinebotPayloads(
          normalizeTravelMonth(oracleMonth),
          normalizeTravelMonth(candidateMonth),
        ),
      ),
    };
    const monthPayload = unwrapTravelPayload(oracleMonth);
    const firstRide = Array.isArray(monthPayload.list)
      ? monthPayload.list.find(
          (item) => item !== null && typeof item === "object" && !Array.isArray(item),
        )
      : null;
    const travelId =
      firstRide && typeof firstRide === "object"
        ? ((firstRide as Record<string, unknown>).travel_id ??
          (firstRide as Record<string, unknown>).travelId ??
          (firstRide as Record<string, unknown>).id)
        : null;
    if (typeof travelId === "string" && travelId.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      const oracleDetail = await runOracle("travel", ["--detail", travelId]);
      // eslint-disable-next-line no-await-in-loop
      const candidateDetail = await travelCandidate.detail({
        fields: {
          ...travelBase,
          nonce: generateNinebotNonce(),
          serviceTime: Date.now(),
          travel_id: travelId,
        } as TravelDetailPlaintextFields,
        businessType: service === "motor" ? "1" : "2",
      });
      travelReport.detail = summarizeReport(
        compareNinebotPayloads(
          normalizeTravelDetail(oracleDetail),
          normalizeTravelDetail(candidateDetail),
        ),
      );
    } else {
      travelReport.detail = { skipped: true, reason: "month-empty" };
    }
    sample.travel = travelReport;
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
    travel: {
      month: ReturnType<typeof summarizeReport>;
      detail: ReturnType<typeof summarizeReport> | { skipped: true; reason: string };
    };
  } => "status" in sample && "battery" in sample && "travel" in sample,
);
const allEqual =
  successfulSamples.length === rounds &&
  successfulSamples.every(
    (sample) =>
      sample.status.equal &&
      sample.battery.equal &&
      sample.travel.month.equal &&
      ("skipped" in sample.travel.detail || sample.travel.detail.equal),
  );
console.log(
  JSON.stringify(
    {
      configDirectoryName: basename(configDirectory),
      vehicleIndex,
      service,
      requestedRounds: rounds,
      month: parityMonth,
      samples,
      allEqual,
    },
    null,
    2,
  ),
);
if (!allEqual) process.exitCode = 1;
