import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ start: vi.fn(), sdk: vi.fn(), legacy: vi.fn() }));
vi.mock("./desktop-main.js", () => ({ startDesktopApp: mocks.start }));
vi.mock("./runtime-sdk.js", () => ({ registerSdkRuntime: mocks.sdk }));
vi.mock("./runtime-legacy.js", () => ({ registerLegacyRuntime: mocks.legacy }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});
describe("desktop entry build selection", () => {
  it("preserves the ordinary legacy default", async () => {
    vi.stubEnv("NINEBOT_AUTH_SOURCE", "");
    await import("./index.ts");
    expect(mocks.start).toHaveBeenCalledWith(mocks.legacy);
  });
  it("preserves the ordinary explicit SDK runtime", async () => {
    vi.stubEnv("NINEBOT_AUTH_SOURCE", "sdk");
    await import("./index.ts");
    expect(mocks.start).toHaveBeenCalledWith(mocks.sdk);
  });
  it("pins the SDK-only entry despite a legacy runtime environment", async () => {
    vi.stubEnv("NINEBOT_AUTH_SOURCE", "legacy");
    await import("./index.sdk.ts");
    expect(mocks.start).toHaveBeenCalledWith(mocks.sdk);
  });
});
