import { constants, createHash, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createNinebotNodeAuthSessionManager } from "./auth-node.ts";
import {
  decryptAesCbcPkcs7,
  deriveNinebotKeyCandidate,
  encryptAesCbcPkcs7,
} from "./crypto-node.ts";

const encoder = new TextEncoder();
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** Loopback peer unwraps the test RSA key and inspects actual encrypted requests. */
const createPeer = async () => {
  const directory = await mkdtemp(join(tmpdir(), "ninebot-auth-loopback-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
  const state = {
    now: 1_800_000_000_000,
    status: 200,
    payload: { code: 1, data: { uid: "business-from-bootstrap" } } as unknown,
    uuid: "0123456789abcdef0123456789abcdef" as string | undefined,
    rejectRefresh: false,
  };
  const paths: string[] = [];
  const businessRequests: Record<string, unknown>[] = [];
  const failures: string[] = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      paths.push(request.url ?? "");
      let payload: unknown;
      if (request.url === "/v6/user/login" || request.url === "/v3/user/refresh") {
        const refresh = request.url === "/v3/user/refresh";
        if (refresh) {
          expect(JSON.parse(body.toString())).toEqual({
            access_token: "account-token",
            device: "ANDROID",
            refresh_token: "refresh-token",
          });
          expect(request.headers.authorization).toBeUndefined();
          // Independent peer checks the actual wire signature with fixed protocol
          // metadata and Node crypto, never the SDK's canonical/signing helper.
          const signingFields = {
            access_token: "account-token",
            app_version: "610063322",
            clientKey: "e177176a-3b3e-1513-e26e-d1123034cb66",
            device: "ANDROID",
            os: "Android",
            os_language: "zh-hans-cn",
            os_version: "13",
            refresh_token: "refresh-token",
            timestamp: request.headers.timestamp,
            url: "/v3/user/refresh",
          };
          const canonical = Object.entries(signingFields)
            .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
            .map(([key, value]) => `${key}=${value}`)
            .join("&");
          expect(request.headers.sign).toBe(createHash("sha256").update(canonical).digest("hex"));
          if (state.rejectRefresh) {
            response.writeHead(200, { "content-type": "application/json" });
            response.end(
              JSON.stringify({ resultCode: 90002, desc: "args missing synthetic-private-text" }),
            );
            return;
          }
        }
        payload = {
          resultCode: 90000,
          data: {
            access_token: refresh ? "refreshed-account-token" : "account-token",
            refresh_token: refresh ? "rotated-refresh-token" : "refresh-token",
            uid: "passport-uid-must-not-be-used",
            business_uid: "passport-business-field-must-not-be-used",
            ...(state.uuid === undefined ? {} : { uuid: state.uuid }),
            accessTokenValidity: String(state.now + 3_600_000),
          },
        };
      } else if (request.url === "/user/user/login") {
        if (state.status !== 200) {
          response.writeHead(state.status);
          response.end("private upstream text");
          return;
        }
        const envelope = JSON.parse(body.toString()) as { k: string; d: string; h: string };
        // Only test-generated keys are decrypted. Inspect the PKCS#1 block explicitly
        // because Node's private PKCS#1 v1.5 API depends on OpenSSL implicit rejection.
        const block = privateDecrypt(
          { key: privateKey, padding: constants.RSA_NO_PADDING },
          Buffer.from(envelope.k, "base64"),
        );
        expect(block.subarray(0, 2)).toEqual(Buffer.from([0, 2]));
        const separator = block.indexOf(0, 2);
        expect(separator).toBeGreaterThanOrEqual(10);
        const kReq = block.subarray(separator + 1);
        const plaintext = decryptAesCbcPkcs7({
          ciphertext: Buffer.from(envelope.d, "base64"),
          key: kReq,
        });
        expect(createHash("md5").update(plaintext).digest("hex")).toBe(envelope.h);
        const wrapper = JSON.parse(Buffer.from(plaintext).toString()) as Record<string, string>;
        businessRequests.push(
          JSON.parse(Buffer.from(wrapper.data!, "base64").toString()) as Record<string, unknown>,
        );
        const key = deriveNinebotKeyCandidate([
          encoder.encode(wrapper.keyDataOne),
          encoder.encode(wrapper.keyDataTwo),
          encoder.encode(wrapper.keyDataThree),
          encoder.encode(wrapper.keyDataFour),
        ]);
        const inner = encoder.encode(
          JSON.stringify({
            data: Buffer.from(JSON.stringify(state.payload)).toString("base64"),
            timeStamp: Math.floor(state.now / 1000),
          }),
        );
        payload = {
          v: 101,
          s: "test-only",
          r: Buffer.from(encryptAesCbcPkcs7({ plaintext: inner, key })).toString("base64"),
        };
      } else if (request.url === "/v5/user") {
        expect(request.headers.authorization).toBe("refreshed-account-token");
        payload = { resultCode: 90000, data: { connected: true } };
      } else {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
      response.end(gzipSync(JSON.stringify(payload)));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "peer failed");
      response.writeHead(500);
      response.end("test peer failed");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback address unavailable");
  const origin = `http://127.0.0.1:${address.port}`;
  const createManager = () =>
    createNinebotNodeAuthSessionManager({
      directory,
      origins: { passport: origin, business: origin },
      rsaPublicKey: publicKey.export({ type: "spki", format: "pem" }),
      now: () => state.now,
    });
  return { directory, state, paths, businessRequests, failures, createManager };
};
const credentials = { user: "synthetic-user", areaCode: "86", password: "synthetic-password" };

describe("Node two-stage authentication over loopback HTTP", () => {
  it("preserves complete login material through restore even when explicit immediate refresh returns 90002", async () => {
    const peer = await createPeer();
    const first = peer.createManager();
    const loggedIn = await first.loginWithPassword(credentials);
    const restored = peer.createManager();
    await expect(restored.restore()).resolves.toEqual(loggedIn);
    peer.state.rejectRefresh = true;
    await expect(restored.refresh()).rejects.toMatchObject({
      resultCode: 90002,
      rejection: "invalid-request",
      descriptionSource: "desc",
    });
    expect(restored.getSession()).toEqual(loggedIn);
    await expect(peer.createManager().restore()).resolves.toEqual(loggedIn);
    expect(peer.paths).toEqual(["/v6/user/login", "/user/user/login", "/v3/user/refresh"]);
    expect(peer.failures).toEqual([]);
    await restored.logout();
  });
  it("bootstraps without Passport uid, refreshes, restores and clears both session formats", async () => {
    const peer = await createPeer();
    const auth = peer.createManager();
    await expect(auth.restore()).resolves.toBeNull();
    await expect(auth.loginWithPassword(credentials)).resolves.toMatchObject({
      businessUid: "business-from-bootstrap",
      accessToken: "account-token",
    });
    expect(peer.paths).toEqual(["/v6/user/login", "/user/user/login"]);
    expect(peer.businessRequests[0]).toMatchObject({
      access_token: "account-token",
      token: "account-token",
      refresh_token: "refresh-token",
      uuid: peer.state.uuid,
      platform_ver: "13 Xiaomi",
      region: "bj",
      serviceTime: peer.state.now,
    });
    expect(
      JSON.parse(await readFile(join(peer.directory, "auth-session.json"), "utf8")),
    ).not.toHaveProperty("password");
    peer.state.now += 3_600_001;
    await expect(auth.whoami()).resolves.toEqual({ connected: true });
    expect(peer.paths).toEqual([
      "/v6/user/login",
      "/user/user/login",
      "/v3/user/refresh",
      "/v5/user",
    ]);
    const restarted = peer.createManager();
    await expect(restarted.restore()).resolves.toMatchObject({
      accessToken: "refreshed-account-token",
      refreshToken: "rotated-refresh-token",
      businessUid: "business-from-bootstrap",
    });
    await writeFile(
      join(peer.directory, "tokens.json"),
      JSON.stringify({ access_token: "legacy", business_uid: "legacy-uid" }),
    );
    await restarted.logout();
    await expect(peer.createManager().restore()).resolves.toBeNull();
    expect(peer.failures).toEqual([]);
  });

  it.each([
    { code: 190003, data: { uid: "wrong" } },
    { code: 1, data: { uid: "" } },
    { code: 1, data: { uid: 42 } },
  ])("does not save a ready session for rejected business response %j", async (payload) => {
    const peer = await createPeer();
    peer.state.payload = payload;
    const auth = peer.createManager();
    await expect(auth.loginWithPassword(credentials)).rejects.toThrow(
      "business session initialization failed",
    );
    expect(auth.isAuthenticated).toBe(false);
    await expect(readFile(join(peer.directory, "auth-session.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(peer.failures).toEqual([]);
  });

  it("preserves an existing account when the next business login fails at HTTP level", async () => {
    const peer = await createPeer();
    const auth = peer.createManager();
    const original = await auth.loginWithPassword(credentials);
    peer.state.status = 503;
    await expect(auth.loginWithPassword(credentials)).rejects.toMatchObject({ status: 503 });
    expect(auth.getSession()).toEqual(original);
    await expect(peer.createManager().restore()).resolves.toEqual(original);
    expect(peer.failures).toEqual([]);
  });

  it("rejects missing bootstrap credentials before sending a business request", async () => {
    const peer = await createPeer();
    peer.state.uuid = undefined;
    const auth = peer.createManager();
    await expect(auth.loginWithPassword(credentials)).rejects.toMatchObject({
      kind: "missing-credentials",
    });
    expect(peer.paths).toEqual(["/v6/user/login"]);
    expect(auth.isAuthenticated).toBe(false);
  });
});
