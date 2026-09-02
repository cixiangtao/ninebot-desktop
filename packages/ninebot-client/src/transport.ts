import type { NinebotServiceName } from "./protocol-lab.ts";

export type NinebotHttpMethod = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";

/** A protocol request independent of the concrete HTTP runtime. */
export interface NinebotRequest {
  service: NinebotServiceName;
  method: NinebotHttpMethod;
  path: string;
  headers: Readonly<Record<string, string>>;
  body?: Uint8Array;
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
}

const responseHeaders = (headers: Headers) =>
  Object.fromEntries(headers.entries()) as Record<string, string>;

/** Fetch-backed transport for callers that already know the service origins. */
export const createFetchNinebotTransport = ({
  origins,
  fetch: fetchImpl = globalThis.fetch,
}: FetchNinebotTransportOptions): NinebotTransport => ({
  async send(request) {
    const origin = origins[request.service];
    if (!origin) throw new Error(`Missing origin for Ninebot service: ${request.service}`);
    const response = await fetchImpl(new URL(request.path, origin), {
      method: request.method,
      headers: request.headers,
      ...(request.body ? { body: new Uint8Array(request.body) } : {}),
    });
    return {
      status: response.status,
      headers: responseHeaders(response.headers),
      body: new Uint8Array(await response.arrayBuffer()),
    };
  },
});
