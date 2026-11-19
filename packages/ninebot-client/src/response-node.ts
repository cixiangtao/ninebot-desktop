import { gunzipSync } from "node:zlib";
import { decodeJsonEnvelope, type NinebotResponseEnvelope } from "./response.ts";
import type { NinebotResponse } from "./transport.ts";

/** Removes the optional gzip content encoding from a Node.js response body. */
export const decodeGzipBody = (response: NinebotResponse) => {
  const encoding = response.headers["content-encoding"]?.toLowerCase();
  // Node's fetch implementation transparently decompresses gzip while preserving
  // the response header; only gunzip when the wire bytes still carry the magic.
  const isGzip = response.body[0] === 0x1f && response.body[1] === 0x8b;
  return encoding?.includes("gzip") && isGzip
    ? new Uint8Array(gunzipSync(response.body))
    : response.body;
};

/** Node.js decoder for the gzip response observed from the passport endpoint. */
export const decodeGzipJsonEnvelope = <T>(
  response: NinebotResponse,
): NinebotResponseEnvelope<T> => {
  return decodeJsonEnvelope<T>({ ...response, body: decodeGzipBody(response) });
};
