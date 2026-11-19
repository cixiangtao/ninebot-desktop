import { describe, expect, it } from "vitest";
import { buildVehicleListRequest, vehicleListPath } from "./vehicle.ts";

describe("vehicle list protocol boundary", () => {
  it("builds the observed opaque request for either vehicle service", () => {
    const request = buildVehicleListRequest({
      service: "motor",
      envelope: { d: "cipher", h: "hash", k: "key", p: "001", t: "1" },
      headers: { uid: "private", platform: "Android" },
    });

    expect(request).toMatchObject({
      service: "motor",
      method: "POST",
      path: vehicleListPath,
      headers: {
        "accept-encoding": "gzip",
        "content-type": "text/html;charset=UTF-8",
        need_decrypt: "1",
        "ninebot-version": "2",
        uid: "private",
        platform: "Android",
      },
    });
    expect(new TextDecoder().decode(request.body)).toBe(
      '{"d":"cipher","h":"hash","k":"key","p":"001","t":"1"}',
    );
  });

  it("allows callers to override observed headers for protocol comparison", () => {
    const request = buildVehicleListRequest({
      service: "ebike",
      envelope: { d: "cipher", h: "hash", k: "key", p: "001", t: "1" },
      headers: { need_decrypt: "0", "client-ver": "test" },
    });

    expect(request.headers.need_decrypt).toBe("0");
    expect(request.headers["client-ver"]).toBe("test");
  });
});
