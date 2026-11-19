import { describe, expect, it } from "vitest";
import { resolveNinebotConfigDirectory } from "./config-directory.js";

describe("Ninebot config directory", () => {
  it("prefers an explicit directory", () => {
    expect(
      resolveNinebotConfigDirectory({
        explicitDirectory: "/tmp/replay",
        userDataDirectory: "/user-data",
        sdkDirectoryExists: true,
        legacyDirectoryExists: true,
      }),
    ).toBe("/tmp/replay");
  });

  it("uses the SDK-owned directory for new installations", () => {
    expect(
      resolveNinebotConfigDirectory({
        userDataDirectory: "/user-data",
        sdkDirectoryExists: false,
        legacyDirectoryExists: false,
      }),
    ).toBe("/user-data/ninebot");
  });

  it("keeps an existing legacy directory usable during migration", () => {
    expect(
      resolveNinebotConfigDirectory({
        userDataDirectory: "/user-data",
        sdkDirectoryExists: false,
        legacyDirectoryExists: true,
      }),
    ).toBe("/user-data/ninecli");
  });
});
