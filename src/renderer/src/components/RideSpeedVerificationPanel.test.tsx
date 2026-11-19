import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { RideSpeedVerificationPanel } from "./RideSpeedVerificationPanel";

const renderPanel = (
  unavailableCount: number,
  overrides: Partial<ComponentProps<typeof RideSpeedVerificationPanel>> = {},
) =>
  renderToStaticMarkup(
    <RideSpeedVerificationPanel
      totalCount={20}
      verifiedCount={0}
      failedCount={0}
      unavailableCount={unavailableCount}
      loading={false}
      error={null}
      disabled={false}
      onVerify={() => undefined}
      {...overrides}
    />,
  );

describe("RideSpeedVerificationPanel", () => {
  it("explains viewport loading and optional month completion", () => {
    const markup = renderPanel(19);

    expect(markup).toContain("19 条无有效采样");
    expect(markup).toContain("列表会自动读取可见及附近行程");
    expect(markup).toContain("补全未读");
  });

  it("keeps the neutral idle state when no known placeholder is visible", () => {
    expect(renderPanel(0)).toContain("已读取 0/20 条");
  });

  it("keeps loading and failure status in the fixed-height summary", () => {
    const idle = renderPanel(0);
    expect(idle).toContain('<details class="ride-speed-verification-help">');
    expect(idle).not.toContain("<details open");
    const failed = renderPanel(0, { error: "演示读取失败", failedCount: 1 });
    expect(failed).toContain('title="读取失败：演示读取失败">峰值读取失败');
    const loading = renderPanel(0, { loading: true, verifiedCount: 3 });
    expect(loading).toContain("已读取 3/20 条");
    expect(loading).toContain("读取峰值中");
    expect(loading).toContain('disabled=""');
    expect(loading.slice(loading.indexOf("</details>"))).not.toContain("<p");
  });
});
