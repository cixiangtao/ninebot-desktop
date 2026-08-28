import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRendererAssetPath } from "./renderer-path.js";

const rendererRoot = resolve("/Applications/骑迹.app/Contents/Resources/app.asar/out/renderer");

describe("packaged renderer protocol", () => {
  it("serves only assets within the renderer root", () => {
    expect(resolveRendererAssetPath(rendererRoot, "qiji://app/index.html")).toBe(
      resolve(rendererRoot, "index.html"),
    );
    expect(resolveRendererAssetPath(rendererRoot, "qiji://app/assets/index.js")).toBe(
      resolve(rendererRoot, "assets/index.js"),
    );
    expect(resolveRendererAssetPath(rendererRoot, "qiji://other/index.html")).toBeNull();
    expect(resolveRendererAssetPath(rendererRoot, "https://app/index.html")).toBeNull();
    expect(resolveRendererAssetPath(rendererRoot, "qiji://app/../../tokens.json")).toBeNull();
    expect(resolveRendererAssetPath(rendererRoot, "qiji://app/%2e%2e%2ftokens.json")).toBeNull();
    expect(resolveRendererAssetPath(rendererRoot, "qiji://app/index.html", "POST")).toBeNull();
  });
});
