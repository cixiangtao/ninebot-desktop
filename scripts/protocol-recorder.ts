import { resolve } from "node:path";
import {
  createOracleOverrideArguments,
  defaultNinebotServiceEndpoints,
  startProtocolRecorder,
  type NinebotServiceName,
} from "../packages/ninebot-client/src/protocol-lab.ts";

const projectRoot = resolve(import.meta.dirname, "..");
const privateCaptureRoot = resolve(projectRoot, ".ninebot-private/protocol-captures");
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");

const help = `Usage: pnpm protocol:record [options]

Options:
  --include-bodies             Store request and response bodies as base64.
  --include-signing-headers    Store clientid, sign, and timestamp values privately.
  --session=<name>             Private capture directory name (default: timestamp).
  --upstream-<service>=<url>   Override an upstream for local recorder testing.
  --help                       Show this help.

Services: passport, business, ebike, motor, travel

All captures stay under .ninebot-private/protocol-captures, which is ignored by Git.
Headers containing credentials or stable device/account identifiers are always redacted.`;

const argumentsList = process.argv.slice(2).filter((argument) => argument !== "--");
if (argumentsList.includes("--help")) {
  console.log(help);
  process.exit(0);
}

const includeBodies = argumentsList.includes("--include-bodies");
const includeSigningHeaders = argumentsList.includes("--include-signing-headers");
const readNamedArgument = (name: string) => {
  const prefix = `--${name}=`;
  return argumentsList.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
};
const sessionName = readNamedArgument("session") ?? timestamp;
if (!/^[a-zA-Z0-9._-]+$/.test(sessionName)) {
  throw new Error(
    "Protocol capture session names may contain only letters, numbers, dot, dash, and underscore",
  );
}

const allowedArguments = new Set(["--include-bodies", "--include-signing-headers"]);
for (const argument of argumentsList) {
  const namedArgument = argument.split("=", 1)[0];
  if (
    allowedArguments.has(argument) ||
    namedArgument === "--session" ||
    /^--upstream-(passport|business|ebike|motor|travel)$/.test(namedArgument ?? "")
  ) {
    continue;
  }
  throw new Error(`Unknown protocol recorder argument: ${argument}`);
}

const endpoints = defaultNinebotServiceEndpoints.map((endpoint) => {
  const override = readNamedArgument(
    `upstream-${endpoint.service}` as `upstream-${NinebotServiceName}`,
  );
  return override ? { ...endpoint, upstreamOrigin: new URL(override).origin } : endpoint;
});
const captureDirectory = resolve(privateCaptureRoot, sessionName);
const recorder = await startProtocolRecorder({
  captureDirectory,
  endpoints,
  includeBodies,
  includeSigningHeaders,
});
const overrideArguments = createOracleOverrideArguments(recorder.listeners);

if (includeBodies) {
  console.warn("Raw protocol bodies are enabled. Treat this capture as account-sensitive data.");
}
if (includeSigningHeaders) {
  console.warn("Signing headers are enabled. Treat this capture as account-sensitive data.");
}
console.log(
  JSON.stringify(
    {
      captureDirectory,
      includeBodies,
      includeSigningHeaders,
      listeners: recorder.listeners.map(({ service, upstreamOrigin, boundPort, overrideFlag }) => ({
        service,
        upstreamOrigin,
        localOrigin: `http://127.0.0.1:${boundPort}`,
        overrideFlag,
      })),
      ninecliArguments: overrideArguments,
    },
    null,
    2,
  ),
);
console.log("Recorder ready. Run ninecli with the printed host override arguments.");

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await recorder.close();
  console.log(`Protocol recorder stopped. Captures: ${captureDirectory}`);
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
