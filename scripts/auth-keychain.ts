import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { ReadStream, WriteStream } from "node:tty";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import type { NinebotPasswordCredentials } from "@jiuhao/ninebot-client/node";

type Common = { store: "login"; account: string; areaCode: string };
export type KeychainSelector = Common &
  (
    | { kind: "generic"; service: "ninebot.com" }
    | {
        kind: "internet";
        server: "ninebot.com";
        protocol: "https" | "http";
        path?: string;
        port?: number;
      }
  );
const reasons = {
  20: "keychain-not-found",
  21: "keychain-ambiguous",
  22: "keychain-cancelled",
  23: "keychain-denied",
  24: "keychain-unavailable",
  25: "keychain-invalid-input",
  26: "keychain-invalid-response",
} as const;
export class KeychainCredentialError extends Error {
  readonly reason: (typeof reasons)[keyof typeof reasons];
  constructor(reason: (typeof reasons)[keyof typeof reasons]) {
    super(reason);
    this.reason = reason;
    this.name = "KeychainCredentialError";
  }
}
const fail = (code: keyof typeof reasons): never => {
  throw new KeychainCredentialError(reasons[code]);
};
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  Buffer.byteLength(value) <= max &&
  [...value].every((character) => {
    const code = character.codePointAt(0)!;
    return code >= 32 && (code < 127 || code > 159);
  });

/** Only a known, exact ninebot.com item; no site/account discovery or Passwords access. */
export const parseKeychainSelector = (value: unknown): KeychainSelector => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(25);
  const record = value as Record<string, unknown>;
  const { account, kind } = record;
  const areaCode = record.areaCode ?? "86";
  if (
    record.store !== "login" ||
    !text(account, 1024) ||
    !account ||
    account.trim() !== account ||
    typeof areaCode !== "string" ||
    !/^\+?\d{1,4}$/.test(areaCode)
  )
    return fail(25);
  const common: Common = { store: "login", account, areaCode };
  const allowed = ["store", "kind", "account", "areaCode"];
  let result: KeychainSelector;
  if (kind === "generic" && record.service === "ninebot.com") {
    allowed.push("service");
    result = { ...common, kind, service: "ninebot.com" };
  } else if (
    kind === "internet" &&
    record.server === "ninebot.com" &&
    (record.protocol === "https" || record.protocol === "http")
  ) {
    allowed.push("server", "protocol", "path", "port");
    result = { ...common, kind, server: "ninebot.com", protocol: record.protocol };
    if (record.path !== undefined) {
      if (!text(record.path, 2048) || (record.path !== "" && !record.path.startsWith("/")))
        return fail(25);
      result.path = record.path;
    }
    if (record.port !== undefined) {
      if (
        !Number.isInteger(record.port) ||
        (record.port as number) < 0 ||
        (record.port as number) > 65535
      )
        return fail(25);
      result.port = record.port as number;
    }
  } else return fail(25);
  if (Object.keys(record).some((key) => !allowed.includes(key))) return fail(25);
  return result;
};

const helperPath = fileURLToPath(
  new URL("../build/generated/auth-keychain/auth-keychain", import.meta.url),
);
const runHelper = async (request: Buffer, signal?: AbortSignal) => {
  if (process.platform !== "darwin") return fail(24);
  if (signal?.aborted) return fail(22);
  // Dedicated fd 3 is the sole secret channel; neither stdout nor stderr is captured or forwarded.
  const child = spawn(helperPath, [], { stdio: ["pipe", "ignore", "ignore", "pipe"], signal });
  const pipe = child.stdio[3];
  const input = child.stdin;
  if (!input || !pipe || !("on" in pipe)) {
    child.kill();
    return fail(24);
  }
  return await new Promise<{ code: number | null; payload: Buffer }>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let length = 0;
    let failed = false;
    const timer = setTimeout(() => stop(24), 120_000);
    const wipe = () => chunks.forEach((chunk) => chunk.fill(0));
    const stop = (code: keyof typeof reasons) => {
      if (failed) return;
      failed = true;
      clearTimeout(timer);
      child.kill();
      wipe();
      reject(new KeychainCredentialError(reasons[code]));
    };
    child.on("error", () => stop(signal?.aborted ? 22 : 24));
    input.on("error", () => stop(24));
    pipe.on("error", () => stop(24));
    pipe.on("data", (chunk: Buffer) => {
      if (failed) {
        chunk.fill(0);
        return;
      }
      length += chunk.length;
      if (length > 16_384) {
        chunk.fill(0);
        stop(26);
        return;
      }
      chunks.push(chunk);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failed) return;
      const payload = Buffer.concat(chunks);
      wipe();
      resolve({ code, payload });
    });
    input.end(request);
  });
};

/** No unattended mode: a controlling terminal must explicitly approve this one operation. */
export const confirmKeychainRead = async (signal?: AbortSignal) => {
  if (signal?.aborted) return fail(22);
  let input: ReadStream | undefined;
  let output: WriteStream | undefined;
  const stream = <T>(mode: "r" | "w", create: (descriptor: number) => T): T => {
    const descriptor = openSync("/dev/tty", mode);
    try {
      return create(descriptor);
    } catch {
      closeSync(descriptor);
      return fail(23);
    }
  };
  try {
    input = stream("r", (descriptor) => new ReadStream(descriptor));
    output = stream("w", (descriptor) => new WriteStream(descriptor));
  } catch {
    input?.destroy();
    output?.destroy();
    return fail(23);
  }
  const prompt = createInterface({ input, output, terminal: true, historySize: 0 });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  input.on("error", cancel);
  output.on("error", cancel);
  prompt.on("SIGINT", cancel);
  prompt.on("close", cancel);
  try {
    const answer = await prompt.question(
      "本次读取一个已有的 ninebot.com login 钥匙串密码，并发送给九号进行 auth-only 验收；确认请输入 READ ONCE：",
      { signal: controller.signal },
    );
    if (answer !== "READ ONCE") return fail(22);
  } catch {
    return fail(22);
  } finally {
    signal?.removeEventListener("abort", cancel);
    prompt.close();
    input.destroy();
    output.destroy();
  }
};

/** Dependencies are injectable for fake-data tests; CLI always uses the private-pipe runner. */
export const readKeychainCredentials = async (
  value: unknown,
  options: {
    signal?: AbortSignal;
    confirm?: () => Promise<void>;
    run?: (
      request: Buffer,
      signal?: AbortSignal,
    ) => Promise<{ code: number | null; payload: Buffer }>;
  } = {},
): Promise<NinebotPasswordCredentials> => {
  const selector = parseKeychainSelector(value);
  const request = Buffer.from(JSON.stringify(selector));
  let payload: Buffer | undefined;
  try {
    await (options.confirm ?? (() => confirmKeychainRead(options.signal)))();
    if (options.signal?.aborted) return fail(22);
    const response = await (options.run ?? runHelper)(request, options.signal);
    payload = response.payload;
    if (response.code !== 0) {
      const code = response.code;
      return fail(
        code !== null && Object.hasOwn(reasons, code) ? (code as keyof typeof reasons) : 24,
      );
    }
    if (payload.length > 16_384) return fail(26);
    const record: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      Object.keys(record).length !== 1 ||
      !("password" in record) ||
      typeof record.password !== "string" ||
      !record.password
    )
      return fail(26);
    return { user: selector.account, password: record.password, areaCode: selector.areaCode };
  } catch (error) {
    if (error instanceof KeychainCredentialError) throw error;
    return fail(options.signal?.aborted ? 22 : 26);
  } finally {
    request.fill(0);
    payload?.fill(0);
  }
};
