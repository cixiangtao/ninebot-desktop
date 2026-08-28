import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoordinatePreviewControl } from "./CoordinatePreviewControl";

describe("CoordinatePreviewControl", () => {
  it("labels the source state as an optional local hypothesis", () => {
    const markup = renderToStaticMarkup(
      <CoordinatePreviewControl
        mode="source"
        shiftMeters={526}
        surface="route"
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain("坐标 · 接口原值");
    expect(markup).toContain("启用GCJ-02转WGS84坐标校准预览");
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('data-shift-meters="526"');
    expect(markup).toContain("原始轨迹、统计和导出不会修改");
  });

  it("makes the active preview and approximate displacement explicit", () => {
    const markup = renderToStaticMarkup(
      <CoordinatePreviewControl
        mode="gcj02-to-wgs84-preview"
        shiftMeters={526}
        surface="location"
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain("校准预览 · 约 530 m");
    expect(markup).toContain("恢复接口原值");
    expect(markup).toContain('aria-pressed="true"');
  });
});
