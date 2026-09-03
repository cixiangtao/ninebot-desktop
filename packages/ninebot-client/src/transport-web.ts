/** Service origins used by the browser-compatible candidate transport. */
export type NinebotWebServiceName = "ebike" | "motor" | "travel";

export type NinebotWebHttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

/** Fetch-independent request shape for browser and React Native hosts. */
export interface NinebotWebRequest {
  service: NinebotWebServiceName;
  method: NinebotWebHttpMethod;
  path: string;
  headers: Readonly<Record<string, string>>;
  body?: Uint8Array;
  signal?: AbortSignal;
}

/** Fetch-independent response shape with already-decoded response bytes. */
export interface NinebotWebResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
}

export interface NinebotWebTransport {
  send(request: NinebotWebRequest): Promise<NinebotWebResponse>;
}

export interface FetchNinebotWebTransportOptions {
  origins: Readonly<Partial<Record<NinebotWebServiceName, string>>>;
  fetch?: typeof globalThis.fetch;
  /** Optional upper bound for one fetch call, in milliseconds. */
  timeoutMs?: number;
}

const responseHeaders = (headers: Headers) =>
  Object.fromEntries(headers.entries()) as Record<string, string>;

/** Creates a browser-compatible Fetch transport without Node or Electron imports. */
export const createFetchNinebotWebTransport = ({
  origins,
  fetch: fetchImpl = globalThis.fetch,
  timeoutMs,
}: FetchNinebotWebTransportOptions): NinebotWebTransport => {
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new Error("Ninebot web fetch timeoutMs must be a positive finite number");
  }

  return {
    async send(request) {
      const origin = origins[request.service];
      if (!origin) throw new Error(`Missing origin for Ninebot web service: ${request.service}`);

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
          () => controller.abort(new Error(`Ninebot web fetch timed out after ${timeoutMs} ms`)),
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
