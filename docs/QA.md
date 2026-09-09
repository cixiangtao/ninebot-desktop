# 验收记录

最后验证：2026-09-09，macOS Apple Silicon。

- `corepack pnpm check`：通过，63 个测试文件、289 个测试通过。
- 真实电自账号：使用本机已有合法会话目录启动 `scripts/qa-live-readonly.mjs`，认证恢复、车辆列表、status/battery、月度汇总与首屏明细、行程详情、速度校验、统计、月度/年度摘要导出、轨迹导出、位置授权边界和状态监看均通过。脚本只输出脱敏布尔值与计数，不保存账号、令牌、SN、坐标或原始响应。
- macOS：`corepack pnpm package:mac:dir` 通过。恢复页冒烟、ASAR/Fuses、ad-hoc 签名、`runtime/ninecli/ninecli` 存在与代码哈希校验通过；成品诊断报告 `runtimeMode: ninecli`、`binaryVerified: true`。
- Windows：在 macOS 上完成 `win32-x64` ninecli 下载、固定 SHA-256 校验和 Electron Builder `release/win-unpacked` 目录包构建；PE machine 为 `0x8664`，包内 ninecli SHA-256 为 `94338e423b1d5219a2f6bfeda9af34271b83814ef725220c2598676ac18d650e`。Windows 原生 NSIS 安装、静默安装后启动和卸载仍待 Windows x64 主机执行，不能由本机静态结果替代。

## 运行时边界

生产主进程只创建 `NineCliClient`，启动时验证随包二进制，退出时终止活动子进程。IPC 只暴露版本化领域操作；车辆序列号、行程 ID、原始响应和保存路径不进入 renderer。允许的 ninecli 命令集合、环境白名单、配置目录权限和错误映射均在 `src/main/ninecli.ts` 与 `src/main/ipc.ts` 中测试覆盖。
