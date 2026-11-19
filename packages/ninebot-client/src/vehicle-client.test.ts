import { describe, expect, it } from "vitest";
import { createNinebotVehicleClient } from "./vehicle-client.ts";
import type { NinebotRequest } from "./transport.ts";
import type { NinebotVehicleCodec } from "./vehicle-codec.ts";

const codec: NinebotVehicleCodec = {
  async encodeRequest() {
    return { d: "cipher", h: "hash", k: "key", p: "001", t: "1" };
  },
  async decodeResponse({ envelope }) {
    return new TextEncoder().encode(`${envelope.v}:${envelope.s}:${envelope.r}`);
  },
};

describe("Ninebot vehicle client", () => {
  it("orchestrates codec, transport, and response decoding", async () => {
    const requests: NinebotRequest[] = [];
    const client = createNinebotVehicleClient({
      codec,
      transport: {
        async send(request) {
          requests.push(request);
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            body: new TextEncoder().encode('{"v":1,"s":"session","r":"cipher"}'),
          };
        },
      },
    });

    await expect(
      client.list({ service: "motor", plaintextBody: new TextEncoder().encode("private") }),
    ).resolves.toEqual(new TextEncoder().encode("1:session:cipher"));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ service: "motor", path: "/vehicle/binding/my-vehicle" });
  });

  it("rejects non-success responses before attempting to decode them", async () => {
    const client = createNinebotVehicleClient({
      codec,
      transport: {
        async send() {
          return { status: 503, headers: {}, body: new Uint8Array() };
        },
      },
    });

    await expect(
      client.list({ service: "ebike", plaintextBody: new Uint8Array() }),
    ).rejects.toMatchObject({
      name: "NinebotHttpError",
      status: 503,
    });
  });

  it("passes codec response context through the high-level client", async () => {
    let receivedContext: unknown;
    const contextualCodec: NinebotVehicleCodec = {
      async encodeRequest() {
        return {
          envelope: { d: "cipher", h: "hash", k: "key", p: "001", t: "1" },
          responseContext: { requestId: "vehicle-list" },
        };
      },
      async decodeResponse({ responseContext }) {
        receivedContext = responseContext;
        return new TextEncoder().encode("decoded");
      },
    };
    const client = createNinebotVehicleClient({
      codec: contextualCodec,
      transport: {
        async send() {
          return {
            status: 200,
            headers: {},
            body: new TextEncoder().encode('{"v":1,"s":"session","r":"cipher"}'),
          };
        },
      },
    });

    await expect(
      client.list({ service: "motor", plaintextBody: new TextEncoder().encode("private") }),
    ).resolves.toEqual(new TextEncoder().encode("decoded"));
    expect(receivedContext).toEqual({ requestId: "vehicle-list" });
  });
});
