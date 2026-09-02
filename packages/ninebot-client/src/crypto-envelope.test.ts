import { describe, expect, it } from "vitest";
import { parseNinebotEncryptedRequest, parseNinebotEncryptedResponse } from "./crypto-envelope.ts";

describe("Ninebot encrypted envelopes", () => {
  it("parses request and response wrapper fields without interpreting ciphertext", () => {
    expect(
      parseNinebotEncryptedRequest('{"d":"cipher","h":"hash","k":"key","p":"001","t":"1"}'),
    ).toEqual({
      d: "cipher",
      h: "hash",
      k: "key",
      p: "001",
      t: "1",
    });
    expect(parseNinebotEncryptedResponse('{"v":1,"s":"session","r":"cipher"}')).toEqual({
      v: 1,
      s: "session",
      r: "cipher",
    });
  });

  it("rejects malformed wrappers before crypto code runs", () => {
    expect(() => parseNinebotEncryptedRequest('{"d":"cipher"}')).toThrow(
      "request envelope field h is invalid",
    );
    expect(() => parseNinebotEncryptedResponse('{"v":"1","s":"session","r":"cipher"}')).toThrow(
      "response envelope field v is invalid",
    );
  });
});
