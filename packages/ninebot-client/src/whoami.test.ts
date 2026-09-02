import { describe, expect, it } from "vitest";
import { buildWhoamiRequest, whoamiRequestBody } from "./whoami.ts";
import { decodeGzipJsonEnvelope, decodeJsonEnvelope } from "./response.ts";

describe("whoami protocol boundary", () => {
  it("builds the observed request shape and delegates signing", async () => {
    const calls: unknown[] = [];
    const request = await buildWhoamiRequest({
      authorization: "Bearer private",
      clientId: "client-private",
      appVersion: "1.0.0",
      os: "ios",
      osLanguage: "zh-CN",
      osVersion: "18.0",
      timestampMs: 1_700_000_000_000,
      signer: (input) => {
        calls.push(input);
        return "signature-private";
      },
    });

    expect(request.service).toBe("passport");
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/v5/user");
    expect(request.headers).toMatchObject({
      authorization: "Bearer private",
      clientid: "client-private",
      sign: "signature-private",
      timestamp: "1700000000000",
    });
    expect(new TextDecoder().decode(request.body)).toBe("{}");
    expect(calls).toHaveLength(1);
    expect(whoamiRequestBody()).toEqual(new TextEncoder().encode("{}"));
  });

  it("decodes JSON envelopes and gzip JSON envelopes", async () => {
    const plain = new TextEncoder().encode(
      JSON.stringify({ data: { id: "private" }, resultCode: 0, resultDesc: "ok" }),
    );
    expect(decodeJsonEnvelope<{ id: string }>({ status: 200, headers: {}, body: plain })).toEqual({
      data: { id: "private" },
      resultCode: 0,
      resultDesc: "ok",
    });

    const gzip = await import("node:zlib").then(({ gzipSync }) => gzipSync(plain));
    expect(
      decodeGzipJsonEnvelope<{ id: string }>({
        status: 200,
        headers: { "content-encoding": "gzip" },
        body: gzip,
      }),
    ).toEqual({ data: { id: "private" }, resultCode: 0, resultDesc: "ok" });
  });
});
