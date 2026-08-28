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
        unresolvedCappedSpeedCount={1}
        ridesTruncated
        onClose={() => undefined}
        onExport={async () => undefined}
      />,
    );

    expect(markup).toContain("可选 20/31 次");
    expect(markup).toContain("已用轨迹校验 19/20 条");
    expect(markup).toContain("未校验的 25 km/h 旧摘要会保持为空");
    expect(markup).toContain("ninecli 当前返回的 20 条可选行程");
    expect(markup).toContain("不包含 GPS、轨迹点、车辆 SN 或九号内部行程 ID");
  });
});
