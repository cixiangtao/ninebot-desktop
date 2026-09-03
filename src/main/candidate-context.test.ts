import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCandidateRequestTracker,
  readCandidateSession,
  readCandidateService,
  readCandidateVehicles,
} from "./candidate-context.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

const createSessionDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "ninebot-candidate-context-"));
  temporaryDirectories.push(directory);
  await Promise.all([
    writeFile(
      join(directory, "config.json"),
      JSON.stringify({
        device_id: "device-id",
        region: "bj",
        os_version: "13",
        os_model: "Xiaomi",
      }),
    ),
    writeFile(
      join(directory, "tokens.json"),
      JSON.stringify({ access_token: "token", business_uid: "12345678" }),
    ),
    writeFile(join(directory, "vehicles.json"), JSON.stringify({ vehicles: [{ wnumber: "SN1" }] })),
  ]);
  return directory;
};

describe("candidate context", () => {
  it("cancels tracked requests and allows a fresh session generation", () => {
    const tracker = createCandidateRequestTracker();
    const first = tracker.start();

    tracker.clear();

    expect(first.signal.aborted).toBe(true);
    const second = tracker.start();
    expect(second.signal.aborted).toBe(false);
    second.release();
  });

  it("normalizes textual and numeric service-family fields", () => {
    expect(readCandidateService({ business_line: "ebike" })).toBe("ebike");
    expect(readCandidateService({ businessType: 1 })).toBe("motor");
    expect(readCandidateService({ businessType: "2" })).toBe("ebike");
    expect(readCandidateService({ businessType: "unknown" })).toBeNull();
  });

  it("builds the shared session fields from local files", async () => {
    const directory = await createSessionDirectory();

    await expect(readCandidateSession(directory)).resolves.toMatchObject({
      device_id: "device-id",
      regionx: "bj",
      platform_ver: "13 Xiaomi",
      access_token: "token",
      uid: "12345678",
    });
  });

  it("prefers the new SDK session file when it exists", async () => {
    const directory = await createSessionDirectory();
    await writeFile(
      join(directory, "auth-session.json"),
      JSON.stringify({ accessToken: "sdk-token", businessUid: "sdk-uid" }),
    );

    await expect(readCandidateSession(directory)).resolves.toMatchObject({
      access_token: "sdk-token",
      uid: "sdk-uid",
    });
  });

  it("uses the authenticated session supplied by the lifecycle manager", async () => {
    const directory = await createSessionDirectory();

    await expect(
      readCandidateSession(directory, {
        accessToken: "fresh-token",
        businessUid: "fresh-uid",
        uuid: "fresh-uuid",
        refreshToken: "fresh-refresh",
      }),
    ).resolves.toMatchObject({
      access_token: "fresh-token",
      uid: "fresh-uid",
      uuid: "fresh-uuid",
      refresh_token: "fresh-refresh",
    });
  });

  it("keeps vehicle metadata loading separate from session credentials", async () => {
    const directory = await createSessionDirectory();

    await expect(readCandidateVehicles(directory)).resolves.toEqual({
      vehicles: [{ wnumber: "SN1" }],
    });
  });

  it("rejects malformed session files before a candidate request is built", async () => {
    const directory = await createSessionDirectory();
    await writeFile(join(directory, "tokens.json"), JSON.stringify({ access_token: "token" }));

    await expect(readCandidateSession(directory)).rejects.toThrow(
      "candidate business_uid is incomplete",
    );
  });
});
