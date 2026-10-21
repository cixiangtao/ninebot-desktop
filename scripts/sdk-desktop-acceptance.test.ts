import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { allowRendererHttpRequest, mapResourceKind } = require("./sdk-desktop-acceptance.cjs") as {
  allowRendererHttpRequest: (url: string) => boolean;
  mapResourceKind: (url: string) => string | null;
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
