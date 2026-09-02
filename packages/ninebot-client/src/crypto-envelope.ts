export interface NinebotEncryptedRequestEnvelope {
  d: string;
  h: string;
  k: string;
  p: string;
  t: string;
}

export interface NinebotEncryptedResponseEnvelope {
  v: number;
  s: string;
  r: string;
}

const parseObject = (body: Uint8Array | string, label: string) => {
  const parsed: unknown =
    typeof body === "string" ? JSON.parse(body) : JSON.parse(new TextDecoder().decode(body));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Ninebot ${label} envelope is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
};

const requiredString = (record: Record<string, unknown>, key: string, label: string) => {
  const value = record[key];
  if (typeof value !== "string")
    throw new Error(`Ninebot ${label} envelope field ${key} is invalid`);
  return value;
};

/** Parses the opaque request wrapper observed on encrypted vehicle endpoints. */
export const parseNinebotEncryptedRequest = (
  body: Uint8Array | string,
): NinebotEncryptedRequestEnvelope => {
  const record = parseObject(body, "request");
  return {
    d: requiredString(record, "d", "request"),
    h: requiredString(record, "h", "request"),
    k: requiredString(record, "k", "request"),
    p: requiredString(record, "p", "request"),
    t: requiredString(record, "t", "request"),
  };
};

/** Parses the opaque response wrapper after any HTTP content encoding is removed. */
export const parseNinebotEncryptedResponse = (
  body: Uint8Array | string,
): NinebotEncryptedResponseEnvelope => {
  const record = parseObject(body, "response");
  const version = record.v;
  if (typeof version !== "number") throw new Error("Ninebot response envelope field v is invalid");
  return {
    v: version,
    s: requiredString(record, "s", "response"),
    r: requiredString(record, "r", "response"),
  };
};
