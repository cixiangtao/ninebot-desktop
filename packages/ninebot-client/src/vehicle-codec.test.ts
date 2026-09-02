import { describe, expect, it } from "vitest";
import {
  buildVehicleListRequestWithCodec,
  decodeVehicleListResponseWithCodec,
  type NinebotVehicleCodec,
} from "./vehicle-codec.ts";

const codec: NinebotVehicleCodec = {
  async encodeRequest() {
    return { d: "cipher", h: "hash", k: "key", p: "001", t: "1" };
  },
  async decodeResponse({ envelope }) {
    return new TextEncoder().encode(`${envelope.v}:${envelope.s}:${envelope.r}`);
  },
};

describe("vehicle codec boundary", () => {
  it("delegates plaintext to a codec before building the opaque request", async () => {
    const request = await buildVehicleListRequestWithCodec({
      service: "ebike",
      plaintextBody: new TextEncoder().encode("private payload"),
      headers: { uid: "private" },
      codec,
    });

    expect(request.service).toBe("ebike");
    expect(new TextDecoder().decode(request.body)).toBe(
      '{"d":"cipher","h":"hash","k":"key","p":"001","t":"1"}',
    );
  });

  it("parses the response envelope before delegating it to a codec", async () => {
    const body = '{"v":1,"s":"session","r":"cipher"}';
    await expect(
      decodeVehicleListResponseWithCodec({ service: "motor", responseBody: body, codec }),
    ).resolves.toEqual(new TextEncoder().encode("1:session:cipher"));
  });
});
