import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { decodeGzipBody } from "./response-node.ts";

describe("Node response body decoder", () => {
  it("decompresses a gzip body when the wire bytes are still compressed", () => {
    const body = new TextEncoder().encode('{"ok":true}');
    expect(
      decodeGzipBody({
        status: 200,
        headers: { "content-encoding": "gzip" },
        body: gzipSync(body),
      }),
    ).toEqual(body);
  });

  it("does not double-decompress fetch's already decoded gzip body", () => {
    const body = new TextEncoder().encode('{"ok":true}');
    expect(decodeGzipBody({ status: 200, headers: { "content-encoding": "gzip" }, body })).toEqual(
      body,
    );
  });
});
