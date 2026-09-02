import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  parseNinebotEncryptedRequest,
  parseNinebotEncryptedResponse,
} from "../packages/ninebot-client/src/crypto-envelope.ts";

const projectRoot = resolve(import.meta.dirname, "..");
const captureRoot = resolve(projectRoot, ".ninebot-private/protocol-captures");

const printUsage = () => {
  console.log("Usage: pnpm protocol:report -- <capture-session>");
  console.log("Reports encrypted envelope shapes without printing body, headers, or identifiers.");
};

const sessionName = process.argv.slice(2).find((argument) => argument !== "--");
if (!sessionName || sessionName === "--help") {
  printUsage();
  process.exit(sessionName === "--help" ? 0 : 1);
}
if (!/^[a-zA-Z0-9._-]+$/.test(sessionName)) {
  throw new Error(
    "Capture session names may contain only letters, numbers, dot, dash, and underscore",
  );
}

const decodeCapturedBody = (body: unknown, label: string) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`${label} body metadata is missing`);
  }
  const encoded = (body as Record<string, unknown>).base64;
  if (typeof encoded !== "string") throw new Error(`${label} body base64 is missing`);
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.toString("base64") !== encoded)
    throw new Error(`${label} body base64 is not canonical`);
  return decoded[0] === 0x1f && decoded[1] === 0x8b ? gunzipSync(decoded) : decoded;
};

const summarizeField = (value: string) => {
  const bytes = Buffer.from(value, "base64");
  const isCanonicalBase64 = bytes.toString("base64") === value;
  return {
    characters: value.length,
    decodedBytes: isCanonicalBase64 ? bytes.length : null,
    isCanonicalBase64,
    isAesBlockAligned: isCanonicalBase64 && bytes.length > 0 && bytes.length % 16 === 0,
  };
};

const summarizeRequest = (body: Uint8Array) => {
  const envelope = parseNinebotEncryptedRequest(body);
  return {
    d: summarizeField(envelope.d),
    h: { characters: envelope.h.length, isLowercaseMd5Shape: /^[0-9a-f]{32}$/.test(envelope.h) },
    k: summarizeField(envelope.k),
    p: { characters: envelope.p.length },
    t: { characters: envelope.t.length },
  };
};

const summarizeResponse = (body: Uint8Array) => {
  const envelope = parseNinebotEncryptedResponse(body);
  return {
    v: envelope.v,
    s: summarizeField(envelope.s),
    r: summarizeField(envelope.r),
  };
};

const directory = resolve(captureRoot, sessionName);
const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).toSorted();
if (files.length === 0) throw new Error(`No capture files found in ${directory}`);

const reports = await Promise.all(
  files.map(async (file) => {
    const capture: unknown = JSON.parse(await readFile(resolve(directory, file), "utf8"));
    if (!capture || typeof capture !== "object" || Array.isArray(capture)) {
      throw new Error(`Capture ${file} is not an object`);
    }
    const record = capture as Record<string, unknown>;
    const request = record.request as Record<string, unknown> | undefined;
    const response = record.response as Record<string, unknown> | undefined;
    try {
      return {
        file,
        service: record.service,
        method: record.method,
        path: record.path,
        request: summarizeRequest(decodeCapturedBody(request?.body, `${file} request`)),
        response: summarizeResponse(decodeCapturedBody(response?.body, `${file} response`)),
      };
    } catch (error) {
      return {
        file,
        error: error instanceof Error ? error.message : "capture could not be summarized",
      };
    }
  }),
);

console.log(JSON.stringify({ session: sessionName, captures: reports }, null, 2));
