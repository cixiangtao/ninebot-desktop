/** Interface palettes only; route speed and warning colors keep their data semantics. */
export const themes = [
  {
    id: "mint",
    name: "清爽青绿",
    description: "明亮、清晰 · 默认",
    colors: ["#f0f4f4", "#ffffff", "#087f76"],
  },
  {
    id: "blue",
    name: "晴空蓝",
    description: "冷白与清透蓝",
    colors: ["#eaf0fa", "#ffffff", "#315fba"],
  },
  {
    id: "violet",
    name: "柔雾紫",
    description: "浅灰与柔和紫",
    colors: ["#f0edf7", "#ffffff", "#7651ab"],
  },
  {
    id: "apricot",
    name: "暖杏橙",
    description: "米白与暖杏色",
    colors: ["#f7efe5", "#fffdf9", "#a85926"],
  },
  {
    id: "forest",
    name: "松绿撞色",
    description: "深松绿与酸橙黄",
    colors: ["#173f35", "#fcfcf8", "#def28a"],
  },
] as const;

export type ThemeId = (typeof themes)[number]["id"];
export const DEFAULT_THEME: ThemeId = "mint";
export const THEME_STORAGE_KEY = "ninebot-desktop.theme";

const themeStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** Unknown or inaccessible preferences fall back to the original light palette. */
export const readSavedTheme = (
  storage: Pick<Storage, "getItem"> | null = themeStorage(),
): ThemeId => {
  try {
    const saved = storage?.getItem(THEME_STORAGE_KEY);
    return themes.find(({ id }) => id === saved)?.id ?? DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
};

/** Returns false when persistence is blocked; the current session may still use the choice. */
export const saveTheme = (
  theme: ThemeId,
  storage: Pick<Storage, "setItem"> | null = themeStorage(),
) => {
  try {
    if (!storage) return false;
    storage.setItem(THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
};

/** Apply before React mounts to avoid flashing a different palette on startup. */
export const applyTheme = (theme: ThemeId) => {
  document.documentElement.dataset.theme = theme;
};
