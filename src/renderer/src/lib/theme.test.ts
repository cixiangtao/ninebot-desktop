import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME, readSavedTheme, saveTheme, THEME_STORAGE_KEY } from "./theme";

describe("palette preference", () => {
  it("defaults to the light palette for absent and unknown preferences", () => {
    expect(readSavedTheme(null)).toBe(DEFAULT_THEME);
    expect(readSavedTheme({ getItem: () => "retired-palette" })).toBe("mint");
    expect(readSavedTheme({ getItem: () => null })).toBe("mint");
  });

  it("restores a recognized palette", () => {
    expect(readSavedTheme({ getItem: () => "blue" })).toBe("blue");
  });

  it("does not block rendering when storage cannot be read", () => {
    expect(
      readSavedTheme({
        getItem: () => {
          throw new Error("Storage blocked");
        },
      }),
    ).toBe("mint");
  });

  it("writes only the appearance preference", () => {
    const setItem = vi.fn();
    expect(saveTheme("violet", { setItem })).toBe(true);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(THEME_STORAGE_KEY, "violet");
  });

  it("reports when a selection cannot persist", () => {
    expect(saveTheme("forest", null)).toBe(false);
    expect(
      saveTheme("apricot", {
        setItem: () => {
          throw new Error("Quota exceeded");
        },
      }),
    ).toBe(false);
  });
});
