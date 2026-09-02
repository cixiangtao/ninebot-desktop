import { createHash } from "node:crypto";
import { once } from "node:events";
import { request as requestHttp } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, Server } from "node:http";
import { createServer } from "node:http";
import { request as requestHttps } from "node:https";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const ninebotServiceNames = ["passport", "business", "ebike", "motor", "travel"] as const;
/** Service families exposed through ninecli's independently configurable upstream hosts. */
export type NinebotServiceName = (typeof ninebotServiceNames)[number];

/** Read-only behavior that the TypeScript client will replace before auth or control work. */
export const readOnlyOracleCapabilities = [
  "whoami",
  "vehicles",
  "status",
  "battery",
  "travel-month",
  "travel-detail",
] as const;
export type ReadOnlyOracleCapability = (typeof readOnlyOracleCapabilities)[number];

/** Maps one upstream service family to its ninecli override flag and loopback listener. */
export interface NinebotServiceEndpoint {
  service: NinebotServiceName;
  upstreamOrigin: string;
  overrideFlag: `--${string}`;
  localPort: number;
}

/** Pinned production origins and non-overlapping local ports observed in ninecli 0.1.7. */
export const defaultNinebotServiceEndpoints = [
  {
    service: "passport",
    upstreamOrigin: "https://api-passport-bj.ninebot.com",
    overrideFlag: "--passport-base",
    localPort: 18_101,
  },
  {
    service: "business",
    upstreamOrigin: "https://api-jhcx-v6-bj.ninebot.com",
    overrideFlag: "--biz-host",
    localPort: 18_102,
  },
  {
    service: "ebike",
    upstreamOrigin: "https://ebike.ninebot.com",
    overrideFlag: "--ebike-host",
    localPort: 18_103,
  },
  {
    service: "motor",
    upstreamOrigin: "https://steeldust.ninebot.com",
    overrideFlag: "--motor-host",
    localPort: 18_104,
  },
  {
    service: "travel",
    upstreamOrigin: "https://cn-cbu-gateway.ninebot.com",
    overrideFlag: "--travel-host",
    localPort: 18_105,
  },
] as const satisfies readonly NinebotServiceEndpoint[];

/** Privacy-preserving body metadata stored for every observed message. */
export interface CapturedBody {
  byteLength: number;
  sha256: string;
  /** Present only after the operator explicitly enables private body capture. */
  base64?: string;
}

/** Redacted headers and optionally captured body content for one HTTP message. */
export interface CapturedMessage {
  headers: Record<string, string | string[]>;
  body: CapturedBody;
}

/** Versioned private record of one request and its upstream response. */
export interface ProtocolExchangeCapture {
  schemaVersion: 1;
  capturedAt: string;
  service: NinebotServiceName;
  method: string;
  path: string;
  request: CapturedMessage;
  response: CapturedMessage & { status: number };
}

/** Configuration for the local-only protocol observation proxy. */
export interface ProtocolRecorderOptions {
  captureDirectory: string;
  endpoints?: readonly NinebotServiceEndpoint[];
  includeBodies?: boolean;
  /** Private-only opt-in to retain headers needed to compare request signatures. */
  includeSigningHeaders?: boolean;
  bindAddress?: string;
  maxBodyBytes?: number;
}

/** Actual listener address, including an OS-assigned port when `localPort` is zero. */
export interface ProtocolRecorderListener extends NinebotServiceEndpoint {
  boundPort: number;
}

/** Running recorder handle. Call `close` to release every service listener. */
export interface ProtocolRecorder {
  listeners: readonly ProtocolRecorderListener[];
  close: () => Promise<void>;
}

const sensitiveHeaderPattern =
  /authorization|cookie|token|secret|session|credential|password|device[-_]?id|user[-_]?id|client[-_]?id|uuid|imei|^sign(?:ature)?$/i;
const signingHeaderPattern = /^(?:client[-_]?id|sign|signature|timestamp)$/i;
const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

/** Creates a deterministic body summary and only includes content after explicit opt-in. */
export const captureBody = (body: Uint8Array, includeBody = false): CapturedBody => {
  const summary = { byteLength: body.byteLength, sha256: sha256(body) };
  return includeBody ? { ...summary, base64: Buffer.from(body).toString("base64") } : summary;
};

const redactHeaderValue = (value: string) =>
  `<redacted bytes=${Buffer.byteLength(value)} sha256=${sha256(value)}>`;

/** Redacts credential-like header values while retaining fingerprints for protocol comparison. */
export const redactHeaders = (
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
  { includeSigningHeaders = false }: { includeSigningHeaders?: boolean } = {},
) =>
  Object.fromEntries(
    Object.entries(headers)
      .filter((entry): entry is [string, string | readonly string[]] => entry[1] !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => {
        const normalizedName = name.toLowerCase();
        const values = typeof value === "string" ? value : [...value];
        if (!sensitiveHeaderPattern.test(normalizedName)) return [normalizedName, values];
        if (includeSigningHeaders && signingHeaderPattern.test(normalizedName)) {
          return [normalizedName, values];
        }
        return [
          normalizedName,
          typeof values === "string" ? redactHeaderValue(values) : values.map(redactHeaderValue),
        ];
      }),
  ) as Record<string, string | string[]>;

const readBody = async (stream: NodeJS.ReadableStream, maximumBytes: number) => {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  for await (const rawChunk of stream) {
    const chunk: unknown = rawChunk;
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : typeof chunk === "string"
        ? Buffer.from(chunk)
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk)
          : null;
    if (!buffer) throw new Error("Protocol stream emitted an unsupported chunk type");
    byteLength += buffer.byteLength;
    if (byteLength > maximumBytes) throw new Error(`Protocol body exceeds ${maximumBytes} bytes`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

const stripHopByHopHeaders = (headers: IncomingHttpHeaders) =>
  Object.fromEntries(
    Object.entries(headers).filter(
      ([name, value]) => value !== undefined && !hopByHopHeaders.has(name.toLowerCase()),
    ),
  );

const getForwardHeaders = (headers: IncomingHttpHeaders, host: string) => ({
  ...stripHopByHopHeaders(headers),
  host,
});

interface ForwardedResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

const forwardRequest = async (
  target: URL,
  method: string,
  headers: IncomingHttpHeaders,
  body: Buffer,
  maximumBytes: number,
) => {
  const request = target.protocol === "https:" ? requestHttps : requestHttp;
  const upstreamRequest = request(target, {
    method,
    headers: getForwardHeaders(headers, target.host),
  });
  const responsePromise = once(upstreamRequest, "response") as Promise<[IncomingMessage]>;
  upstreamRequest.setTimeout(45_000, () => upstreamRequest.destroy(new Error("Upstream timeout")));
  upstreamRequest.end(body);
  const [upstreamResponse] = await responsePromise;
  return {
    status: upstreamResponse.statusCode ?? 502,
    headers: upstreamResponse.headers,
    body: await readBody(upstreamResponse, maximumBytes),
  } satisfies ForwardedResponse;
};

const closeServer = (server: Server) =>
  new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });

/**
 * Starts one loopback reverse proxy per Ninebot service family and records private exchanges.
 *
 * Header credentials are always redacted. Bodies are stored only when `includeBodies` is true.
 */
export const startProtocolRecorder = async ({
  captureDirectory,
  endpoints = defaultNinebotServiceEndpoints,
  includeBodies = false,
  includeSigningHeaders = false,
  bindAddress = "127.0.0.1",
  maxBodyBytes = 32 * 1024 * 1024,
}: ProtocolRecorderOptions): Promise<ProtocolRecorder> => {
  await mkdir(captureDirectory, { recursive: true, mode: 0o700 });
  let captureSequence = 0;

  const startEndpoint = async (endpoint: NinebotServiceEndpoint) => {
    const server = createServer(async (incomingRequest, outgoingResponse) => {
      const captureNumber = (captureSequence += 1);
      try {
        const requestBody = await readBody(incomingRequest, maxBodyBytes);
        const target = new URL(incomingRequest.url ?? "/", endpoint.upstreamOrigin);
        const result = await forwardRequest(
          target,
          incomingRequest.method ?? "GET",
          incomingRequest.headers,
          requestBody,
          maxBodyBytes,
        );
        const capture: ProtocolExchangeCapture = {
          schemaVersion: 1,
          capturedAt: new Date().toISOString(),
          service: endpoint.service,
          method: incomingRequest.method ?? "GET",
          path: incomingRequest.url ?? "/",
          request: {
            headers: redactHeaders(incomingRequest.headers, { includeSigningHeaders }),
            body: captureBody(requestBody, includeBodies),
          },
          response: {
            status: result.status,
            headers: redactHeaders(result.headers, { includeSigningHeaders }),
            body: captureBody(result.body, includeBodies),
          },
        };
        const filename = `${captureNumber.toString().padStart(4, "0")}-${endpoint.service}.json`;
        await writeFile(join(captureDirectory, filename), `${JSON.stringify(capture, null, 2)}\n`, {
          mode: 0o600,
        });
        outgoingResponse.writeHead(result.status, stripHopByHopHeaders(result.headers));
        outgoingResponse.end(result.body);
      } catch (error) {
        console.error(
          `Protocol recorder ${endpoint.service} request failed`,
          error instanceof Error ? error.name : "UnknownError",
        );
        if (!outgoingResponse.headersSent) outgoingResponse.writeHead(502);
        outgoingResponse.end("Protocol recorder upstream failure");
      }
    });
    await new Promise<void>((resolveListen, reject) => {
      server.once("error", reject);
      server.listen(endpoint.localPort, bindAddress, resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      await closeServer(server);
      throw new Error(`Unable to resolve recorder address for ${endpoint.service}`);
    }
    return { server, listener: { ...endpoint, boundPort: address.port } };
  };
  const startResults = await Promise.allSettled(endpoints.map(startEndpoint));
  const started = startResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failure = startResults.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) {
    await Promise.all(started.map(({ server }) => closeServer(server)));
    throw failure.reason;
  }

  return {
    listeners: started.map(({ listener }) => listener),
    close: async () =>
      Promise.all(started.map(({ server }) => closeServer(server))).then(() => undefined),
  };
};

/** Builds ninecli host-override arguments for a running recorder. */
export const createOracleOverrideArguments = (
  listeners: readonly ProtocolRecorderListener[],
  bindAddress = "127.0.0.1",
) =>
  listeners.flatMap(({ overrideFlag, boundPort }) => [
    overrideFlag,
    `http://${bindAddress}:${boundPort}`,
  ]);
