import { createServer, type RequestListener } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchNinebotTransport, NinebotPassportRedirectError } from "./transport.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
const listen = async (listener: RequestListener) => {
  const server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing loopback address");
  return `http://127.0.0.1:${address.port}`;
};
const marker = "synthetic-secret-never-forward";
const request = {
  service: "passport" as const,
  method: "POST" as const,
  path: "/v3/user/refresh",
  headers: { "content-type": "application/json", authorization: marker },
  body: new TextEncoder().encode(
    JSON.stringify({ accessToken: marker, refreshToken: marker, device: "ANDROID" }),
  ),
};

describe("Passport redirect boundary over actual Fetch", () => {
  it("reproduces default Fetch rewriting POST to an empty GET after 302", async () => {
    const seen: Array<{ method?: string; empty: boolean }> = [];
    const origin = await listen(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      if (req.url === request.path) {
        res.writeHead(302, { location: "/target" });
        res.end();
        return;
      }
      seen.push({
        ...(req.method ? { method: req.method } : {}),
        empty: Buffer.concat(chunks).length === 0,
      });
      res.end(JSON.stringify({ resultCode: 90002 }));
    });
    const response = await fetch(`${origin}${request.path}`, {
      method: "POST",
      body: request.body,
    });
    expect(await response.json()).toEqual({ resultCode: 90002 });
    expect(seen).toEqual([{ method: "GET", empty: true }]);
  });

  it.each([301, 302, 303, 307, 308])(
    "rejects %s without reaching another origin or retaining its private Location",
    async (status) => {
      let targetRequests = 0;
      const target = await listen((_req, res) => {
        targetRequests += 1;
        res.end("unexpected");
      });
      let initialRequests = 0;
      let initialMaterialMatches = false;
      const origin = await listen(async (req, res) => {
        initialRequests += 1;
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        initialMaterialMatches =
          req.method === "POST" &&
          req.headers.authorization === marker &&
          Buffer.concat(chunks).equals(request.body);
        res.writeHead(status, { location: `${target}/${marker}?token=${marker}` });
        res.end(marker);
      });
      const transport = createFetchNinebotTransport({ origins: { passport: origin } });
      const error = await transport.send(request).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NinebotPassportRedirectError);
      expect(error).toMatchObject({ name: "NinebotPassportRedirectError", status });
      expect(initialRequests).toBe(1);
      expect(initialMaterialMatches).toBe(true);
      expect(targetRequests).toBe(0);
      expect(String(error)).not.toContain(marker);
      expect(JSON.stringify(error)).not.toContain(marker);
      expect(JSON.stringify(error)).not.toContain(target);
    },
  );

  it.each([90000, 90002])("preserves a direct HTTP 200 business result %s", async (resultCode) => {
    const payload = JSON.stringify({ resultCode });
    const origin = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(payload);
    });
    const response = await createFetchNinebotTransport({ origins: { passport: origin } }).send(
      request,
    );
    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(response.body)).toBe(payload);
  });

  it("preserves non-Passport redirect behavior", async () => {
    const origin = await listen((req, res) => {
      if (req.url === request.path) {
        res.writeHead(302, { location: "/target" });
        res.end();
      } else res.end(req.method);
    });
    const response = await createFetchNinebotTransport({ origins: { ebike: origin } }).send({
      ...request,
      service: "ebike",
    });
    expect(new TextDecoder().decode(response.body)).toBe("GET");
  });

  it.each(["opaque", "already-followed"])(
    "rejects an %s redirect from a Fetch host without retaining its response",
    async (kind) => {
      const response = new Response(marker);
      Object.defineProperty(response, kind === "opaque" ? "type" : "redirected", {
        value: kind === "opaque" ? "opaqueredirect" : true,
      });
      const cancel = vi.spyOn(response.body!, "cancel").mockRejectedValue(new Error(marker));
      const fetchImpl = vi.fn<typeof fetch>(async () => response);
      const transport = createFetchNinebotTransport({
        origins: { passport: "https://example.test" },
        fetch: fetchImpl,
      });
      const error = await transport.send(request).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NinebotPassportRedirectError);
      expect(error).toMatchObject({ status: 0 });
      expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe("manual");
      expect(cancel).toHaveBeenCalledOnce();
      expect(String(error)).not.toContain(marker);
    },
  );
});
