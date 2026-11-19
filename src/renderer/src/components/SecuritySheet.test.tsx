import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RuntimeSecurityStatus } from "../../../shared/contracts";
import { SecuritySheet } from "./SecuritySheet";

const status: RuntimeSecurityStatus = {
  version: "0.1.7",
  candidate: {
    requestTimeoutMs: 15_000,
    domains: {
      vehicle: "ninecli",
      telemetry: "candidate",
      travel: "ninecli",
    },
  },
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
    expect(markup).toContain("候选读取等待上限");
    expect(markup).toContain("15 秒");
    expect(markup).toContain("1/3 已启用");
    expect(markup).toContain("只读白名单");
    expect(markup).not.toContain("ninecli");
    expect(markup).not.toContain(status.version);
    expect(markup).not.toContain(status.binary.sha256);
    expect(markup).not.toContain(status.storage.directoryName);
    expect(markup).not.toContain(status.policy.allowedCommands.join(" · "));
  });
  it("describes in-process SDK credentials without a binary or fallback warning", () => {
    const sdkStatus = {
      ...status,
      version: "typescript-sdk",
      binary: { ...status.binary, status: "not-required" as const },
      candidate: {
        ...status.candidate,
        domains: {
          vehicle: "candidate" as const,
          telemetry: "candidate" as const,
          travel: "candidate" as const,
        },
      },
      policy: {
        ...status.policy,
        passwordTransport: "in-memory-call" as const,
        smsCodeTransport: "in-memory-call" as const,
      },
    };
    const markup = renderToStaticMarkup(
      <SecuritySheet
        open
        busy={false}
        error={null}
        status={sdkStatus}
        profile={null}
        profileError={null}
        onClose={() => undefined}
        onRefresh={async () => undefined}
        onLogout={async () => undefined}
      />,
    );
    expect(markup).toContain("内置只读服务");
    expect(markup).toContain("进程内调用");
    expect(markup).not.toContain("自动回退");
    expect(markup).not.toContain("登录瞬间可能被本机进程工具观察到");
  });
});
