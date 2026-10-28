import { Check, Palette, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { applyTheme, readSavedTheme, saveTheme, themes, type ThemeId } from "../lib/theme";

/** Live palette preview with native radio keyboard navigation and local persistence. */
export const ThemePicker = () => {
  const [theme, setTheme] = useState(() => readSavedTheme());
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(true);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    container.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.current?.contains(event.target))
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const select = (next: ThemeId) => {
    applyTheme(next);
    setTheme(next);
    setSaved(saveTheme(next));
  };

  return (
    <div
      className="theme-picker no-drag"
      ref={container}
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <button
        type="button"
        className="theme-trigger"
        ref={trigger}
        aria-label="切换配色"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? "theme-picker-panel" : undefined}
        onClick={() => setOpen((value) => !value)}
        title="切换界面配色"
      >
        <Palette size={17} />
        <span>配色</span>
      </button>
      {open ? (
        <section
          className="theme-panel"
          id="theme-picker-panel"
          role="dialog"
          aria-label="界面配色"
        >
          <header>
            <strong>界面配色</strong>
            <button
              type="button"
              aria-label="关闭配色选择"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <X size={16} />
            </button>
          </header>
          <p>选一套看着舒服的，立即预览。</p>
          <fieldset>
            <legend className="sr-only">选择配色方案</legend>
            {themes.map((option) => (
              <label className="theme-option" key={option.id}>
                <input
                  className="sr-only"
                  type="radio"
                  name="interface-theme"
                  value={option.id}
                  checked={theme === option.id}
                  onChange={() => select(option.id)}
                />
                <span className="theme-swatches" aria-hidden="true">
                  {option.colors.map((color) => (
                    <i key={color} style={{ backgroundColor: color }} />
                  ))}
                </span>
                <span className="theme-option-copy">
                  <strong>{option.name}</strong>
                  <small>{option.description}</small>
                </span>
                {theme === option.id ? <Check size={16} aria-hidden="true" /> : null}
              </label>
            ))}
          </fieldset>
          <footer role="status">
            {saved ? "自动记住选择 · 不改变地图速度图例" : "暂时无法保存，当前选择仅本次生效"}
          </footer>
        </section>
      ) : null}
    </div>
  );
};
