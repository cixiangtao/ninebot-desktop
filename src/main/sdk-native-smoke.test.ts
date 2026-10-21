import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ app: {}, ipcMain: {}, session: {} }));
import { assertSmokeDirectories, pickSmokeFlags } from "./sdk-native-smoke.ts";

describe("native SDK smoke remains scoped and non-secret", () => {
  const root = "/synthetic/ninebot-sdk-native-smoke-test";
  it("requires this run's user-data and config underneath the fresh root", () => {
    expect(() =>
      assertSmokeDirectories(root, join(root, "user-data"), join(root, "config")),
    ).not.toThrow();
    expect(() =>
      assertSmokeDirectories(root, "/synthetic/existing", join(root, "config")),
    ).toThrow();
    expect(() =>
      assertSmokeDirectories(root, join(root, "user-data"), "/synthetic/real-account"),
    ).toThrow();
    expect(() =>
      assertSmokeDirectories(
        "/synthetic/existing",
        "/synthetic/existing/user-data",
        "/synthetic/existing/config",
      ),
    ).toThrow();
  });
  it("retains only fixed boolean completion flags", () => {
    expect(
      pickSmokeFlags({
        rendererMounted: true,
        sdkIdentity: true,
        bridgeRoundTrip: true,
        unauthenticated: true,
        private: "synthetic-private",
        accessToken: "synthetic-private",
      }),
    ).toEqual({
      rendererMounted: true,
      sdkIdentity: true,
      bridgeRoundTrip: true,
      unauthenticated: true,
    });
  });
  it.each([null, {}, { rendererMounted: "true", sdkIdentity: 1 }])(
    "does not turn malformed completion into success %#",
    (value) => {
      expect(Object.values(pickSmokeFlags(value)).every(Boolean)).toBe(false);
    },
  );
});
