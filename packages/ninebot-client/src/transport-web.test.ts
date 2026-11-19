import { describe, expect, it } from "vitest";
import { createFetchNinebotWebTransport } from "./transport-web.ts";

describe("browser-compatible Ninebot transport", () => {
  it("builds an origin-relative request and returns response bytes", async () => {
    let observedUrl = "";
    let observedInit: RequestInit | undefined;
    const transport = createFetchNinebotWebTransport({
      origins: { ebike: "https://example.test/api/" },
      fetch: async (input, init) => {
        observedUrl = String(input);
        observedInit = init;
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "x-request-id": "abc" },
        });
      },
    });

    const response = await transport.send({
      service: "ebike",
      method: "POST",
      path: "/vehicle/vehicle/desktop-component",
      headers: { "content-type": "application/json" },
      body: new Uint8Array([9, 8]),
    });

    expect(observedUrl).toBe("https://example.test/vehicle/vehicle/desktop-component");
    expect(observedInit?.method).toBe("POST");
    expect(observedInit?.headers).toEqual({ "content-type": "application/json" });
    const observedBody = observedInit?.body;
    expect(observedBody).toBeInstanceOf(Uint8Array);
    expect(observedBody).toEqual(new Uint8Array([9, 8]));
    expect(response).toMatchObject({
      status: 200,
      headers: { "x-request-id": "abc" },
      body: new Uint8Array([1, 2, 3]),
    });
  });

  it("forwards caller cancellation and preserves its reason", async () => {
    const transport = createFetchNinebotWebTransport({
      origins: { travel: "https://example.test" },
      fetch: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    });
    const controller = new AbortController();
    const pending = transport.send({
      service: "travel",
      method: "POST",
      path: "/app-api/travel/v6/travel-info",
      headers: {},
      signal: controller.signal,
    });
    controller.abort(new Error("caller cancelled"));

    await expect(pending).rejects.toThrow("caller cancelled");
  });

  it("times out a stalled fetch and validates configuration", async () => {
    const transport = createFetchNinebotWebTransport({
      origins: { motor: "https://example.test" },
      timeoutMs: 5,
      fetch: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        }),
    });
    const pending = transport.send({
      service: "motor",
      method: "POST",
      path: "/vehicle/binding/my-vehicle",
      headers: {},
    });
    await expect(pending).rejects.toThrow("timed out after 5 ms");
    expect(() =>
      createFetchNinebotWebTransport({ origins: { motor: "https://example.test" }, timeoutMs: 0 }),
    ).toThrow("timeoutMs must be a positive finite number");
  });

  it("fails before fetch when an origin is not configured", async () => {
    let fetchCalls = 0;
    const transport = createFetchNinebotWebTransport({
      origins: { ebike: "https://example.test" },
      fetch: async () => {
        fetchCalls += 1;
        return new Response("");
      },
    });

    await expect(
      transport.send({ service: "travel", method: "POST", path: "/missing", headers: {} }),
    ).rejects.toThrow("Missing origin for Ninebot service: travel");
    expect(fetchCalls).toBe(0);
  });
});
