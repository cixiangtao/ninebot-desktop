import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { demoVehicle } from "../data/demo";
import { LocationDashboard } from "./LocationDashboard";

describe("LocationDashboard sharing permission", () => {
  it("explains a denied shared-location permission and keeps recovery available", () => {
    const markup = renderToStaticMarkup(
      <LocationDashboard
        vehicle={{ ...demoVehicle, access: "shared" }}
        location={null}
        permission="denied"
        authorized
        live
        loading={false}
        error={null}
        updatedAt={Date.now()}
        coordinateDisplayMode="source"
        onAuthorize={() => undefined}
        onRefresh={() => undefined}
        onClear={() => undefined}
        onCoordinateDisplayModeChange={() => undefined}
      />,
    );

    expect(markup).toContain("共享权限不包含车辆位置");
    expect(markup).toContain("请让车主在九号出行中调整共享权限");
    expect(markup).toContain("重新检查权限");
    expect(markup).not.toContain("九号服务没有返回有效位置");
  });
});
