import { describe, expect, it } from "vitest";
import { createNinebotClient } from "./client.ts";
import type { NinebotRequest, NinebotResponse } from "./transport.ts";

const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

const clientOptions = (send: (request: NinebotRequest) => Promise<NinebotResponse>) => ({
  authorization: "Bearer private",
  clientId: "client-private",
  appVersion: "1.0.0",
  os: "ios",
  osLanguage: "zh-CN",
  osVersion: "18.0",
  timestampMs: 1_700_000_000_000,
  signer: () => "signature-private",
  transport: { send },
});

describe("Ninebot client", () => {
  it("sends whoami through the injected transport and decodes the envelope", async () => {
    const requests: NinebotRequest[] = [];
    const client = createNinebotClient(
      clientOptions(async (request) => {
        requests.push(request);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: json({ data: { id: "private" }, resultCode: 0, resultDesc: "ok" }),
        };
      }),
    );

    await expect(client.whoami<{ id: string }>()).resolves.toEqual({
      data: { id: "private" },
      resultCode: 0,
      resultDesc: "ok",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ service: "passport", method: "POST", path: "/v5/user" });
  });

  it("fails without exposing an error response body", async () => {
    const client = createNinebotClient(
      clientOptions(async () => ({
        status: 401,
        headers: {},
        body: json({ data: { token: "private" }, resultCode: 401, resultDesc: "private" }),
      })),
    );

    await expect(client.whoami()).rejects.toMatchObject({
      name: "NinebotHttpError",
      status: 401,
      message: "Ninebot request failed with HTTP 401",
    });
  });
});
