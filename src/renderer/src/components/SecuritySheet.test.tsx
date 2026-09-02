import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RuntimeSecurityStatus } from "../../../shared/contracts";
import { SecuritySheet } from "./SecuritySheet";

const status: RuntimeSecurityStatus = {
  version: "0.1.7",
  binary: {
    status: "verified",
    sha256: "2d8aef91a74275528c995217fc7a56e5e2507d069acbd28f340e0aa573908f0a",
    expectedSha256: "2d8aef91a74275528c995217fc7a56e5e2507d069acbd28f340e0aa573908f0a",
    platform: "darwin",
    architecture: "arm64",
  },
  storage: {
    directoryName: "ninecli",
    tokensPresent: false,
    permissions: "restricted",
  },
  policy: {
    allowedCommands: ["battery", "status", "travel"],
    environment: "minimal",
    passwordTransport: "process-arguments",
    smsCodeTransport: "process-arguments",
    vehicleControlsExposed: false,
    sessionCache: {
      storage: "memory-only",
      rawResponsesStored: false,
      persistsAcrossRestarts: false,
      manualRefreshBypasses: true,
    },
  },
};

describe("SecuritySheet", () => {
  it("keeps the local adapter implementation private", () => {
    const markup = renderToStaticMarkup(
      <SecuritySheet
        open
        busy={false}
        error={null}
        status={status}
        profile={null}
        profileError={null}
        onClose={() => undefined}
        onRefresh={async () => undefined}
        onLogout={async () => undefined}
      />,
    );

    expect(markup).toContain("隐私与安全");
    expect(markup).toContain("本地数据运行环境");
    expect(markup).toContain("只读白名单");
    expect(markup).not.toContain("ninecli");
    expect(markup).not.toContain(status.version);
    expect(markup).not.toContain(status.binary.sha256);
    expect(markup).not.toContain(status.storage.directoryName);
    expect(markup).not.toContain(status.policy.allowedCommands.join(" · "));
  });
});
