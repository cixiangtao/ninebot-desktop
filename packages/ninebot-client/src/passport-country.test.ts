import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createNinebotPassportSigner } from "./passport-signer-node.ts";
import { createNinebotPassportWebSigner } from "./passport-signer.ts";
import { createFetchNinebotTransport } from "./transport.ts";
import { decodeGzipBody } from "./response-node.ts";
import { gzipSync } from "node:zlib";
import {
  buildPassportCountryListRequest,
  createNinebotPassportCountryClient,
  parsePassportCountryResult,
  PassportCountryHttpError,
  type PassportCountryListInput,
} from "./passport-country.ts";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
// Synthetic directory, not a recorded service response. Wire names come from APK annotations.
const country = {
  N: "0044",
  B: "GB",
  C_en: "United Kingdom",
  C_zh: "英国",
  R: "opaque",
  limit: "opaque-limit",
  firstWord: "U",
};
const fixture = {
  resultCode: "90000",
  data: { version: "0007", countryList: { U: [country], Z: [] } },
};
const metadata = {
  clientId: "synthetic-id",
  clientKey: "synthetic-key",
  appVersion: "synthetic-version",
  os: "Android",
  osLanguage: "en",
  osVersion: "13",
  timestampMs: 123,
};

const response = (body: unknown = fixture, status = 200) => ({
  status,
  headers: {},
  body: encode(body),
});

describe("APK country directory (offline, no account or network)", () => {
  it.each([
    ["v4", false, "GET", "/v4/country_mutil_c.json"],
    ["v4", true, "GET", "/v4/country_mutil_cn.json"],
    ["v5", false, "POST", "/v5/country_mutil_c.json"],
    ["v5", true, "POST", "/v5/country_mutil_cn.json"],
  ] as const)(
    "constructs %s Chinese=%s and signs parameter v without the query",
    async (generation, orderByChinese, method, path) => {
      const canonical = `app_version=synthetic-version&clientKey=synthetic-key&os=Android&os_language=en&os_version=13&timestamp=123&url=${path}&v=7`;
      const expected = createHash("sha256").update(canonical).digest("hex");
      await Promise.all(
        [createNinebotPassportWebSigner().country, createNinebotPassportSigner().country].map(
          async (signer) => {
            const request = await buildPassportCountryListRequest({
              ...metadata,
              generation,
              orderByChinese,
              version: 7,
              signer,
            });
            expect(request.method).toBe(method);
            expect(request.path).toBe(method === "GET" ? `${path}?v=7` : path);
            expect(request.headers.sign).toBe(expected);
            expect(
              Object.keys(request.headers).some((key) => /authorization|cookie/i.test(key)),
            ).toBe(false);
            if (method === "GET") {
              expect(request).not.toHaveProperty("body");
              expect(request.headers).not.toHaveProperty("content-type");
            } else expect(new TextDecoder().decode(request.body)).toBe('{"v":"7"}');
          },
        ),
      );
    },
  );

  it("uses the APK overload default, isolates signer mutations, and preserves cancellation", async () => {
    const controller = new AbortController();
    const request = await buildPassportCountryListRequest({
      generation: "v5",
      version: 0,
      signal: controller.signal,
      signer: (input) => {
        input.body.fill(0);
        return "synthetic";
      },
    });
    expect(request.path).toBe("/v5/country_mutil_c.json");
    expect(new TextDecoder().decode(request.body)).toBe('{"v":"0"}');
    expect(request.signal).toBe(controller.signal);
  });

  it.each([NaN, Infinity, 1.5, 2_147_483_648, -2_147_483_649])(
    "rejects invalid Java version %s before signing/sending",
    async (version) => {
      const signer = vi.fn(() => "unused");
      const send = vi.fn();
      const client = createNinebotPassportCountryClient({ transport: { send }, signer });
      await expect(client.list({ generation: "v5", version })).rejects.toThrow("Java int");
      expect(signer).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("rejects unsupported variants and invalid timestamps locally", async () => {
    await Promise.all(
      [
        { generation: "v6", version: 0 },
        { generation: "v5", version: 0, orderByChinese: "true" },
      ].map(async (input) => {
        await expect(
          buildPassportCountryListRequest({
            ...(input as PassportCountryListInput),
            signer: () => "unused",
          }),
        ).rejects.toThrow("variant");
      }),
    );
    await expect(
      buildPassportCountryListRequest({
        generation: "v5",
        version: 0,
        timestampMs: NaN,
        signer: () => "unused",
      }),
    ).rejects.toThrow("timestamp");
  });

  it("maps compact wire keys, preserves grouped order and strings without interpreting them", () => {
    const result = parsePassportCountryResult(fixture);
    expect(result).toEqual({
      resultCode: "90000",
      data: {
        version: "0007",
        countriesByGroup: {
          U: [
            {
              areaCode: "0044",
              isoCode: "GB",
              enName: "United Kingdom",
              zhName: "英国",
              region: "opaque",
              limit: "opaque-limit",
              firstWord: "U",
            },
          ],
          Z: [],
        },
      },
    });
    expect(Object.keys(result.data!.countriesByGroup!)).toEqual(["U", "Z"]);
  });

  it("preserves missing/null data and groups without inventing cache hits", () => {
    expect(parsePassportCountryResult({ resultCode: "unrecognized", data: null })).toEqual({
      resultCode: "unrecognized",
      data: null,
    });
    expect(parsePassportCountryResult({ data: {} })).toEqual({
      resultCode: null,
      data: { version: null, countriesByGroup: null },
    });
    expect(
      parsePassportCountryResult({ data: { version: "7", countryList: {} } }).data
        ?.countriesByGroup,
    ).toEqual({});
    expect(
      parsePassportCountryResult({ data: { json: { wrong: [country] } } }).data?.countriesByGroup,
    ).toBeNull();
    const partial = parsePassportCountryResult({ data: { countryList: { X: [{}] } } });
    expect(Object.values(partial.data!.countriesByGroup!)[0]![0]).toEqual({
      areaCode: null,
      isoCode: null,
      enName: null,
      zhName: null,
      region: null,
      limit: null,
      firstWord: null,
    });
  });

  it.each([
    null,
    [],
    { resultCode: {} },
    { data: [] },
    { data: { version: 7 } },
    { data: { countryList: [] } },
    { data: { countryList: { X: {} } } },
    { data: { countryList: { X: [null] } } },
    { data: { countryList: { X: [{ N: 44 }] } } },
  ])("rejects malformed response %# without retaining upstream content", (value) => {
    expect(() => parsePassportCountryResult(value)).toThrow(/^Invalid Passport country response/);
  });

  it("handles a group named __proto__ as data without changing prototypes", () => {
    const parsed = parsePassportCountryResult(
      JSON.parse('{"data":{"countryList":{"__proto__":[]}}}'),
    );
    const groups = parsed.data!.countriesByGroup!;
    expect(Object.hasOwn(groups, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(groups)).toBe(Object.prototype);
  });

  it.each(["v4", "v5"] as const)(
    "runs %s through the existing fetch boundary with no real requests",
    async (generation) => {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify(fixture), { status: 200 }));
      const client = createNinebotPassportCountryClient({
        transport: createFetchNinebotTransport({
          origins: { passport: "https://passport.example.invalid" },
          fetch: fetchImpl,
        }),
        now: () => 123,
      });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect((await client.list({ generation, version: 7 })).data?.version).toBe("0007");
      expect(fetchImpl).toHaveBeenCalledOnce();
      const [url, options] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
      expect(url.href).toBe(
        `https://passport.example.invalid/${generation}/country_mutil_c.json${generation === "v4" ? "?v=7" : ""}`,
      );
      expect(options.redirect).toBe("manual");
      expect(options.method).toBe(generation === "v4" ? "GET" : "POST");
    },
  );

  it("does not fallback, retry, or infer success from a Passport code", async () => {
    const send = vi.fn(async () =>
      response({ resultCode: "90001", resultDesc: "sensitive upstream text", data: null }),
    );
    const client = createNinebotPassportCountryClient({ transport: { send } });
    await expect(client.list({ generation: "v5", version: 0 })).resolves.toEqual({
      resultCode: "90001",
      data: null,
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("supports the existing gzip decoder without retaining descriptions", async () => {
    const client = createNinebotPassportCountryClient({
      transport: {
        send: async () => ({
          status: 200,
          headers: { "content-encoding": "gzip" },
          body: new Uint8Array(gzipSync(encode(fixture))),
        }),
      },
      responseBodyDecoder: decodeGzipBody,
    });
    expect((await client.list({ generation: "v5", version: 0 })).data?.version).toBe("0007");
  });

  it("reports HTTP and invalid JSON errors without upstream excerpts", async () => {
    const http = createNinebotPassportCountryClient({
      transport: { send: async () => response({ message: "sensitive" }, 503) },
    });
    await expect(http.list({ generation: "v5", version: 0 })).rejects.toBeInstanceOf(
      PassportCountryHttpError,
    );
    const json = createNinebotPassportCountryClient({
      transport: {
        send: async () => ({
          status: 200,
          headers: {},
          body: new TextEncoder().encode("sensitive upstream text"),
        }),
      },
    });
    await expect(json.list({ generation: "v5", version: 0 })).rejects.toThrow(
      /^Invalid Passport country JSON response$/,
    );
  });
});
