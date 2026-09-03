import { describe, expect, it } from "vitest";
import { createFetchNinebotTransport } from "./transport.ts";

const request = {
  service: "ebike" as const,
  method: "POST" as const,
  path: "/status",
  headers: {},
};

describe("fetch transport", () => {
  it("aborts a fetch that exceeds the configured timeout", async () => {
    let observedSignal: AbortSignal | null | undefined;
    const fetchImpl: typeof globalThis.fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        observedSignal = init?.signal;
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    const transport = createFetchNinebotTransport({
      origins: { ebike: "https://example.test" },
      fetch: fetchImpl,
      timeoutMs: 5,
    });

    await expect(transport.send(request)).rejects.toThrow("timed out after 5 ms");
    expect(observedSignal?.aborted).toBe(true);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid timeout value (%s)",
    (timeoutMs) => {
      expect(() =>
        createFetchNinebotTransport({
          origins: { ebike: "https://example.test" },
          timeoutMs,
        }),
      ).toThrow("timeoutMs must be a positive finite number");
    },
  );
});
