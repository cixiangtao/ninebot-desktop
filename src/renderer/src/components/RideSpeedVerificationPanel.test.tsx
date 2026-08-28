import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RideSpeedVerificationPanel } from "./RideSpeedVerificationPanel";

const renderPanel = (placeholderCount: number) =>
  renderToStaticMarkup(
    <RideSpeedVerificationPanel
      totalCount={20}
      verifiedCount={0}
      correctedCount={0}
      failedCount={0}
      placeholderCount={placeholderCount}
      loading={false}
      error={null}
      disabled={false}
      onVerify={() => undefined}
    />,
  );

describe("RideSpeedVerificationPanel", () => {
  it("explains why historical 25 km/h rows need trail verification", () => {
    const markup = renderPanel(19);

    expect(markup).toContain("发现 19 条 25 km/h 旧摘要，校验后显示轨迹极速");
    expect(markup).toContain("仅在你操作后读取最多 20 条轨迹详情");
    expect(markup).toContain("校验全部");
  });

  it("keeps the neutral idle state when no known placeholder is visible", () => {
    expect(renderPanel(0)).toContain("尚未批量校验");
  });
});
