import { gunzipSync } from "node:zlib";
import { decodeJsonEnvelope, type NinebotResponseEnvelope } from "./response.ts";
import type { NinebotResponse } from "./transport.ts";

/** Removes the optional gzip content encoding from a Node.js response body. */
export const decodeGzipBody = (response: NinebotResponse) => {
  const encoding = response.headers["content-encoding"]?.toLowerCase();
  return encoding?.includes("gzip") ? new Uint8Array(gunzipSync(response.body)) : response.body;
};

/** Node.js decoder for the gzip response observed from the passport endpoint. */
export const decodeGzipJsonEnvelope = <T>(
  response: NinebotResponse,
): NinebotResponseEnvelope<T> => {
  return decodeJsonEnvelope<T>({ ...response, body: decodeGzipBody(response) });
};
