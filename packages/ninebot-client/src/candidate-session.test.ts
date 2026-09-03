import { describe, expect, it } from "vitest";
import {
  createNinebotCandidateSessionClient,
  createNinebotFetchCandidateSessionClient,
} from "./candidate-session.ts";
import type { NinebotRequest, NinebotTransport } from "./transport.ts";

const session = {
  sys_language: "zh-hans-cn",
  client_ver: "610063322",
  device_id: "device-id",
  regionx: "bj",
  language: "zh",
  ostype: "and",
  lang: "zh",
  platform_ver: "13 Xiaomi",
  platform: "android",
  login_country: "CN",
  access_token: "token",
  uid: "12345678",
} as const;

const expectUpstreamFailure = (request: Promise<unknown>) =>
  expect(request).rejects.toThrow("Ninebot request failed with HTTP 500");

describe("candidate session client", () => {
  it("builds all read-only request families from one session contract", async () => {
    const requests: NinebotRequest[] = [];
    const transport: NinebotTransport = {
      send: async (request) => {
        requests.push(request);
        return { status: 500, headers: {}, body: new Uint8Array() };
      },
    };
    const client = createNinebotCandidateSessionClient({
      transport,
      platform: 2,
      session,
      clock: () => 1_725_000_000_000,
      nonceFactory: () => "0123456789abcdef0123456789abcdef",
      requestIdFactory: () => "fedcba9876543210fedcba9876543210",
    });
    await expectUpstreamFailure(client.status({ service: "ebike", serialNumber: "SN1234567890" }));
    await expectUpstreamFailure(client.battery({ service: "ebike", serialNumber: "SN1234567890" }));
    await expectUpstreamFailure(client.listVehicles({ service: "ebike", vehicleType: 14363 }));
    await expectUpstreamFailure(
      client.month({
        service: "ebike",
        serialNumber: "SN1234567890",
        vehicleType: 14363,
        month: "202608",
      }),
    );
    await expectUpstreamFailure(
      client.detail({
        service: "ebike",
        serialNumber: "SN1234567890",
        vehicleType: 14363,
        travelId: "travel-12345678901234567890",
      }),
    );

    expect(requests.map(({ service, path }) => `${service}:${path}`)).toEqual([
      "ebike:/vehicle/vehicle/desktop-component",
      "ebike:/v6/vehicle/battery-info",
      "ebike:/vehicle/binding/my-vehicle",
      "travel:/app-api/travel/v6/travel-list2",
      "travel:/app-api/travel/v6/travel-info",
    ]);
    expect(requests[0]?.headers["business-type"]).toBe("2");
    expect(requests[3]?.headers["business-type"]).toBe("2");
    expect(requests[3]?.headers["rn-ver"]).toBe("743");
    expect(requests.every(({ headers }) => headers["service-time"] === "1725000000000")).toBe(true);
    expect(
      requests.every(({ headers }) => headers["request-id"] === "fedcba9876543210fedcba9876543210"),
    ).toBe(true);
    expect(requests.every(({ body }) => body !== undefined && body.byteLength > 0)).toBe(true);
  });

  it("rejects invalid model codes before sending a request", async () => {
    const transport: NinebotTransport = {
      send: async () => ({ status: 500, headers: {}, body: new Uint8Array() }),
    };
    const client = createNinebotCandidateSessionClient({ transport, platform: 2, session });

    await expect(
      client.listVehicles({ service: "ebike", vehicleType: Number.NaN }),
    ).rejects.toThrow("vehicleType must be finite");
  });

  it("stops future requests after the caller clears the session", async () => {
    let sendCount = 0;
    const transport: NinebotTransport = {
      send: async () => {
        sendCount += 1;
        return { status: 500, headers: {}, body: new Uint8Array() };
      },
    };
    const client = createNinebotCandidateSessionClient({ transport, platform: 2, session });

    client.clear();
    await expect(client.status({ service: "ebike", serialNumber: "SN1234567890" })).rejects.toThrow(
      "session client is closed",
    );
    expect(sendCount).toBe(0);
  });

  it("forwards a caller cancellation signal to the transport", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const transport: NinebotTransport = {
      send: async (request) => {
        signals.push(request.signal);
        return { status: 500, headers: {}, body: new Uint8Array() };
      },
    };
    const client = createNinebotCandidateSessionClient({ transport, platform: 2, session });
    const controller = new AbortController();

    await expect(
      client.status({ service: "ebike", serialNumber: "SN1234567890", signal: controller.signal }),
    ).rejects.toThrow("Ninebot request failed with HTTP 500");
    expect(signals).toEqual([controller.signal]);
  });

  it("uses validated default origins through the fetch convenience factory", async () => {
    let observedUrl = "";
    const client = createNinebotFetchCandidateSessionClient({
      platform: 2,
      session,
      fetch: async (input) => {
        observedUrl = String(input);
        return new Response("", { status: 500 });
      },
    });

    await expect(client.status({ service: "ebike", serialNumber: "SN1234567890" })).rejects.toThrow(
      "Ninebot request failed with HTTP 500",
    );
    expect(observedUrl).toBe("https://ebike.ninebot.com/vehicle/vehicle/desktop-component");
  });

  it("merges partial origin overrides with the remaining defaults", async () => {
    const observedUrls: string[] = [];
    const client = createNinebotFetchCandidateSessionClient({
      platform: 2,
      session,
      origins: { ebike: "https://example.test" },
      fetch: async (input) => {
        observedUrls.push(String(input));
        return new Response("", { status: 500 });
      },
    });

    await expect(client.status({ service: "ebike", serialNumber: "SN1234567890" })).rejects.toThrow(
      "Ninebot request failed with HTTP 500",
    );
    await expect(
      client.month({
        service: "ebike",
        serialNumber: "SN1234567890",
        vehicleType: 14363,
        month: "202608",
      }),
    ).rejects.toThrow("Ninebot request failed with HTTP 500");
    expect(observedUrls).toEqual([
      "https://example.test/vehicle/vehicle/desktop-component",
      "https://cn-cbu-gateway.ninebot.com/app-api/travel/v6/travel-list2",
    ]);
  });
});
