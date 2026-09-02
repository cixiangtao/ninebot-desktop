import { gunzipSync } from "node:zlib";
import type { NinebotResponse } from "./transport.ts";

export interface NinebotResponseEnvelope<T> {
  data: T;
  resultCode: number | string | null;
  resultDesc: string | null;
}

const decodeEnvelope = <T>(body: Uint8Array): NinebotResponseEnvelope<T> => {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
  if (!parsed || typeof parsed !== "object")
    throw new Error("Ninebot response is not a JSON object");
  const record = parsed as Record<string, unknown>;
  const resultCode = record.resultCode;
  const resultDesc = record.resultDesc;
  if (resultCode !== null && typeof resultCode !== "number" && typeof resultCode !== "string") {
    throw new Error("Ninebot response has an invalid resultCode");
  }
  if (resultDesc !== null && typeof resultDesc !== "string") {
    throw new Error("Ninebot response has an invalid resultDesc");
  }
  return {
    data: record.data as T,
    resultCode: resultCode === undefined ? null : resultCode,
    resultDesc: resultDesc === undefined ? null : resultDesc,
  };
};

export const decodeJsonEnvelope = <T>(response: NinebotResponse): NinebotResponseEnvelope<T> =>
  decodeEnvelope<T>(response.body);

/** Decodes the gzip response observed from the passport endpoint before parsing its envelope. */
export const decodeGzipJsonEnvelope = <T>(
  response: NinebotResponse,
): NinebotResponseEnvelope<T> => {
  const encoding = response.headers["content-encoding"]?.toLowerCase();
  const body = encoding?.includes("gzip") ? gunzipSync(response.body) : response.body;
  return decodeEnvelope<T>(body);
};
