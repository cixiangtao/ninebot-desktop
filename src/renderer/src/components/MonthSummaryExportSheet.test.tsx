import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MonthSummaryExportSheet } from "./MonthSummaryExportSheet";

describe("MonthSummaryExportSheet", () => {
  it("discloses truncated rows and keeps unverified capped speed empty", () => {
    const markup = renderToStaticMarkup(
      <MonthSummaryExportSheet
        open
        busy={false}
        activeFormat={null}
        error={null}
        vehicleName="F90"
        month="202607"
        rideCount={31}
        visibleRideCount={20}
        verifiedSpeedCount={19}
        unreadSpeedCount={1}
        ridesTruncated
        onClose={() => undefined}
        onExport={async () => undefined}
      />,
    );

    expect(markup).toContain("可选 20/31 次");
    expect(markup).toContain("已读取轨迹结果 19/20 条");
    expect(markup).toContain("未读取或无有效采样的轨迹峰值会保持为空");
    expect(markup).toContain("SDK 当前成功返回的 20 条可选行程");
    expect(markup).toContain("不包含 GPS、轨迹点、车辆 SN 或九号内部行程 ID");
  });
});
