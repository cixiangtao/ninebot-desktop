import { decodeJsonEnvelope, type NinebotResponseEnvelope } from "./response.ts";
import { buildWhoamiRequest, type BuildWhoamiRequestOptions } from "./whoami.ts";
import type { NinebotResponse, NinebotTransport } from "./transport.ts";

export interface NinebotClientOptions extends BuildWhoamiRequestOptions {
  transport: NinebotTransport;
  responseDecoder?: NinebotResponseDecoder;
}

export type NinebotResponseDecoder = <T>(response: NinebotResponse) => NinebotResponseEnvelope<T>;

export class NinebotHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Ninebot request failed with HTTP ${status}`);
    this.name = "NinebotHttpError";
    this.status = status;
  }
}

/** Minimal typed client facade; additional read-only capabilities can share this transport later. */
export const createNinebotClient = (options: NinebotClientOptions) => ({
  async whoami<T = unknown>(): Promise<NinebotResponseEnvelope<T>> {
    const request = await buildWhoamiRequest(options);
    const response = await options.transport.send(request);
    if (response.status < 200 || response.status >= 300) {
      throw new NinebotHttpError(response.status);
    }
    return (options.responseDecoder ?? decodeJsonEnvelope)<T>(response);
  },
});

export type NinebotClient = ReturnType<typeof createNinebotClient>;
