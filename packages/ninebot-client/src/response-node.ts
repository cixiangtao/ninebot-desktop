import { gunzipSync } from "node:zlib";
import { decodeJsonEnvelope, type NinebotResponseEnvelope } from "./response.ts";
import type { NinebotResponse } from "./transport.ts";

/** Node.js decoder for the gzip response observed from the passport endpoint. */
export const decodeGzipJsonEnvelope = <T>(
  response: NinebotResponse,
): NinebotResponseEnvelope<T> => {
  const encoding = response.headers["content-encoding"]?.toLowerCase();
  if (!encoding?.includes("gzip")) return decodeJsonEnvelope<T>(response);
  return decodeJsonEnvelope<T>({ ...response, body: gunzipSync(response.body) });
};
