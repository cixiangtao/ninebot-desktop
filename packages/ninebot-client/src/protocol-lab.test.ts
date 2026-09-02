import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureBody,
  createOracleOverrideArguments,
  redactHeaders,
  startProtocolRecorder,
  type NinebotServiceEndpoint,
} from "./protocol-lab.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("protocol lab", () => {
  it("redacts credential-like headers but preserves comparable fingerprints", () => {
    const headers = redactHeaders({
      Authorization: "Bearer private-token",
      "X-Device-Id": "private-device",
      ClientId: "private-client",
      Sign: "private-signature",
      Accept: "application/json",
    });

    expect(headers.accept).toBe("application/json");
    expect(headers.authorization).toMatch(/^<redacted bytes=20 sha256=[a-f0-9]{64}>$/);
    expect(headers["x-device-id"]).toMatch(/^<redacted bytes=14 sha256=[a-f0-9]{64}>$/);
    expect(headers.clientid).toMatch(/^<redacted bytes=14 sha256=[a-f0-9]{64}>$/);
    expect(headers.sign).toMatch(/^<redacted bytes=17 sha256=[a-f0-9]{64}>$/);
    expect(JSON.stringify(headers)).not.toContain("private-token");
    expect(JSON.stringify(headers)).not.toContain("private-device");
    expect(JSON.stringify(headers)).not.toContain("private-client");
    expect(JSON.stringify(headers)).not.toContain("private-signature");
  });

  it("captures bodies only after explicit opt-in", () => {
    const body = Buffer.from("sensitive payload");
    expect(captureBody(body)).toEqual({
      byteLength: 17,
      sha256: "23b1b59df858712a05c5caeb1bfa39a701cbc842294858af686cd7d1aeac4d28",
    });
    expect(captureBody(body, true).base64).toBe(body.toString("base64"));
  });

  it("forwards bytes through the recorder and writes a redacted exchange", async () => {
    const captureDirectory = await mkdtemp(join(tmpdir(), "ninebot-protocol-capture-"));
    temporaryDirectories.push(captureDirectory);
    const upstream = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      response.setHeader("set-cookie", "session=private-response-token");
      response.end(Buffer.concat(chunks));
    });
    await new Promise<void>((resolveListen) => upstream.listen(0, "127.0.0.1", resolveListen));
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === "string") throw new Error("Missing address");
    const endpoint: NinebotServiceEndpoint = {
      service: "travel",
      upstreamOrigin: `http://127.0.0.1:${upstreamAddress.port}`,
      overrideFlag: "--travel-host",
      localPort: 0,
    };
    const recorder = await startProtocolRecorder({ captureDirectory, endpoints: [endpoint] });
    try {
      const [listener] = recorder.listeners;
      if (!listener) throw new Error("Missing recorder listener");
      const response = await fetch(`http://127.0.0.1:${listener.boundPort}/route?id=private`, {
        method: "POST",
        headers: { Authorization: "Bearer private-request-token" },
        body: "encrypted-body",
      });
      expect(await response.text()).toBe("encrypted-body");
      expect(createOracleOverrideArguments([listener])).toEqual([
        "--travel-host",
        `http://127.0.0.1:${listener.boundPort}`,
      ]);
      const [captureFile] = await readdir(captureDirectory);
      if (!captureFile) throw new Error("Missing capture file");
      const capture = JSON.parse(await readFile(join(captureDirectory, captureFile), "utf8"));
      expect(capture.path).toBe("/route?id=private");
      expect(capture.request.body).not.toHaveProperty("base64");
      expect(capture.response.body).not.toHaveProperty("base64");
      expect(JSON.stringify(capture)).not.toContain("private-request-token");
      expect(JSON.stringify(capture)).not.toContain("private-response-token");
      expect(JSON.stringify(capture)).not.toContain("encrypted-body");
    } finally {
      await Promise.all([
        recorder.close(),
        new Promise<void>((resolveClose, reject) =>
          upstream.close((error) => (error ? reject(error) : resolveClose())),
        ),
      ]);
    }
  });
});
