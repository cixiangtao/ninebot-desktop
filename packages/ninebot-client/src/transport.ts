import type { NinebotServiceName } from "./protocol-lab.ts";

export type NinebotHttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

/** A protocol request independent of the concrete HTTP runtime. */
export interface NinebotRequest {
  service: NinebotServiceName;
  method: NinebotHttpMethod;
  path: string;
  headers: Readonly<Record<string, string>>;
  body?: Uint8Array;
  /** Optional caller-owned cancellation signal for this read-only request. */
  signal?: AbortSignal;
}

/** The raw response returned by a transport implementation. */
export interface NinebotResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
}

/** Pluggable boundary for Node, browser, React Native, or a test double. */
export interface NinebotTransport {
  send(request: NinebotRequest): Promise<NinebotResponse>;
}

export interface FetchNinebotTransportOptions {
  origins: Readonly<Partial<Record<NinebotServiceName, string>>>;
  fetch?: typeof globalThis.fetch;
  /** Optional upper bound for one fetch call, in milliseconds. */
  timeoutMs?: number;
}

const responseHeaders = (headers: Headers) =>
  Object.fromEntries(headers.entries()) as Record<string, string>;

/** Fetch-backed transport for callers that already know the service origins. */
export const createFetchNinebotTransport = ({
  origins,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs,
}: FetchNinebotTransportOptions): NinebotTransport => {
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new Error("Ninebot fetch timeoutMs must be a positive finite number");
  }

  return {
    async send(request) {
      const origin = origins[request.service];
      if (!origin) throw new Error(`Missing origin for Ninebot service: ${request.service}`);

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      let requestSignal = request.signal;
      let removeAbortListener: (() => void) | undefined;
      if (timeoutMs !== undefined) {
        const controller = new AbortController();
        if (request.signal) {
          const abort = () => controller.abort(request.signal?.reason);
          if (request.signal.aborted) abort();
          else {
            request.signal.addEventListener("abort", abort, { once: true });
            removeAbortListener = () => request.signal?.removeEventListener("abort", abort);
          }
        }
        timeoutHandle = setTimeout(
          () => controller.abort(new Error(`Ninebot fetch timed out after ${timeoutMs} ms`)),
          timeoutMs,
        );
        requestSignal = controller.signal;
      }

      try {
        const response = await fetchImpl(new URL(request.path, origin), {
          method: request.method,
          headers: request.headers,
          ...(request.body ? { body: new Uint8Array(request.body) } : {}),
          ...(requestSignal ? { signal: requestSignal } : {}),
        });
        return {
          status: response.status,
          headers: responseHeaders(response.headers),
          body: new Uint8Array(await response.arrayBuffer()),
        };
      } finally {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        removeAbortListener?.();
      }
    },
  };
};
