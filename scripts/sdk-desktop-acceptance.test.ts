import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { allowRendererHttpRequest, mapResourceKind, observeAuthLifecycle } =
  require("./sdk-desktop-acceptance.cjs") as {
    allowRendererHttpRequest: (url: string) => boolean;
    mapResourceKind: (url: string) => string | null;
    observeAuthLifecycle: (prototype: object, record: (...args: unknown[]) => void) => void;
  };

describe("isolated desktop renderer network", () => {
  it.each([
    ["styles/positron", "style"],
    ["planet", "source"],
    ["planet/public-test/0/0/0.pbf", "vectorTile"],
    ["sprites/ofm/ofm.png", "sprite"],
    ["fonts/Noto%20Sans/0-255.pbf", "glyph"],
    ["natural_earth/ne2sr/0/0/0.png", "rasterTile"],
  ])("allows existing OpenFreeMap resource %s", (path, kind) => {
    const url = `https://tiles.openfreemap.org/${path}`;
    expect(allowRendererHttpRequest(url)).toBe(true);
    expect(mapResourceKind(url)).toBe(kind);
  });

  it.each([
    "http://tiles.openfreemap.org/styles/positron",
    "https://tiles.openfreemap.org.evil.invalid/styles/positron",
    "https://tiles.openfreemap.org@evil.invalid/",
    "https://name:secret@tiles.openfreemap.org/styles/positron",
    "https://tiles.openfreemap.org:444/styles/positron",
    "https://other.invalid/",
    "data:text/plain,ignored",
    "invalid url",
  ])("does not broaden external recipients: %s", (url) => {
    expect(allowRendererHttpRequest(url)).toBe(false);
    expect(mapResourceKind(url)).toBe(null);
  });

  it("records only fixed resource categories, without paths or coordinates", () => {
    expect(
      mapResourceKind("https://tiles.openfreemap.org/planet/test/14/10000/6000.pbf?private=1"),
    ).toBe("vectorTile");
  });
});

describe("acceptance auth lifecycle diagnostics", () => {
  it("forwards results without reading secret or profile fields", async () => {
    const untouched = new Proxy(
      {},
      {
        get() {
          throw new Error("Fields must not be read");
        },
      },
    );
    // A Promise checks the then property itself; expose only that protocol property.
    const result = new Proxy(untouched, {
      get(target, key) {
        return key === "then" ? undefined : Reflect.get(target, key);
      },
    });
    class Manager {
      async restore() {
        return result;
      }
      async refresh() {
        return result;
      }
      async whoami() {
        return result;
      }
    }
    const events: unknown[][] = [];
    observeAuthLifecycle(Manager.prototype, (...event) => events.push(event));
    const manager = new Manager();
    expect(await manager.restore()).toBe(result);
    expect(await manager.refresh()).toBe(result);
    expect(await manager.whoami()).toBe(result);
    expect(events).toEqual([
      ["restore", "started"],
      ["restore", "completed", true],
      ["refresh", "started"],
      ["refresh", "completed", undefined],
      ["whoami", "started"],
      ["whoami", "completed", undefined],
    ]);
  });

  it("keeps failed and absent sessions distinct without serializing errors", async () => {
    const originalError = new Error("private error is never logged");
    class Manager {
      async restore() {
        return null;
      }
      async refresh() {
        throw originalError;
      }
      async whoami() {
        throw originalError;
      }
    }
    const events: unknown[][] = [];
    observeAuthLifecycle(Manager.prototype, (...event) => events.push(event));
    const manager = new Manager();
    expect(await manager.restore()).toBe(null);
    await expect(manager.refresh()).rejects.toBe(originalError);
    await expect(manager.whoami()).rejects.toBe(originalError);
    expect(events).toEqual([
      ["restore", "started"],
      ["restore", "completed", false],
      ["refresh", "started"],
      ["refresh", "failed"],
      ["whoami", "started"],
      ["whoami", "failed"],
    ]);
    expect(JSON.stringify(events)).not.toContain("private error");
  });
});
