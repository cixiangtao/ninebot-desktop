# 以桌面实际能力替代 ninecli（2026-10-21）

用户已明确：目标是 ninebot-desktop 所需能力和移除 legacy 运行依赖，API 可以重设计；不要求兼容 ninecli 的命令、flags、默认参数、JSON 文案或退出码。不为未使用的控制指令或全部官方 App 能力补实现。APK 只在核对本项目所需协议时使用；部件查询扩展暂停，不是替代前提。

当前普通入口仍默认 legacy，`NINEBOT_AUTH_SOURCE=sdk` 明确 opt-in。此轮不切默认、不删除旧版本、不推送、不操作 PID21819 或真实会话。SDK 的应用合同是 `NinebotAppClient` 与 renderer IPC，而不是子进程输出。

## 可核验的必要能力矩阵

“已有”指代码实现存在；自动合成通过、历史真实证据与待真实验收分别列出，不相互替代。历史真实结果来自既有验收记录/用户反馈，本轮未重新请求或观察实例。

| 必需流程                 | SDK / 桌面实现与自身合同                                                                              | 自动证据                                                                              | 真实证据与剩余缺口                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 密码登录与连接状态       | auth-node 的 Passport→Business 两阶段，只接受完整会话；失败不替换旧会话；SDK app client→IPC           | auth-node、auth-result、sdk-desktop-runtime 测试                                      | 用户报告密码验收七阶段通过；独立 SDK 桌面登录曾通过，不推广所有账号/车型                                        |
| 恢复、刷新、退出         | SDK store、并发刷新/替换竞态、显式退出；桌面 legacySession=ignore，不依赖运行 ninecli 或读取旧 tokens | auth、store、auth-node、桌面合成生命周期及恢复→业务→刷新回归                          | SDK恢复/profile已有实测；真实自然刷新和当前窗口的完整退出/重登仍待验收。切换时需明确保留旧文件、SDK重新登录策略 |
| 短信与挑战               | SDK发码/消费及Business初始化；挑战受控报错，不虚报成功；旧表单晚到响应忽略                            | passport-sms、sms-login-flow、离线 Electron QA                                        | 真实 SMS 未验收；内嵌挑战未实现，保留受控边界，不绕过验证                                                       |
| 车辆（自有/共享）        | vehicle-source及SDK车辆客户端；发现ebike/motor；输出自有VehicleSummary/opaque ID                      | vehicle-source、vehicle-node、SDK及IPC测试                                            | 历史单账号车辆通过；双服务成功空列表仍误报错，需独立修复；跨账号/新增服务族持久元数据缓存需回归                 |
| 状态、电池、位置         | telemetry SDK、BMS/锁/点火/续航/充电解析，按需授权位置；不包含控制操作                                | telemetry-node、分区快照、位置桥接与本轮真实reader→IPC合成测试                        | 历史五类读取及位置桥接记录不等于所有车型通过；本轮修复错误契约，尚未加载进当前实例                              |
| 月度行程、详情、分页     | travel SDK及candidate-session全月分页，桌面RideMonth/RideDetail；本地统计/回放/导出复用结果           | travel-node、candidate-session-core正常20/20/5分页、parsers/统计/IPC                  | 月度/详情历史实测通过；SDK分页缺重复ID/重复页完整性校验，不能仅凭条数宣称完整                                   |
| 错误与会话失效           | 自有NinebotClientError→IPC；明确HTTP401与既有auth错误通知重新登录；临时错误允许分区降级               | **本轮完成** sdk-app-client及sdk-read-error-integration；覆盖403/未知业务码不误判auth | 合成回归通过；不等于本轮真实401或服务故障验收                                                                   |
| 缓存、刷新、取消         | IPC TTL、并发合并、手动绕缓存、失效清理及迟到结果保护；无需旧进程                                     | session-read-cache、sdk-read-diagnostics、reader取消/竞态测试                         | 缓存命中不证明新网络读取或自然刷新；账户变化后的持久车辆元数据策略仍需补齐                                      |
| 跨平台运行、离线构建     | Node/TS SDK，无Python/Go子进程需求；同一应用合同可用于macOS/Windows                                   | SDK/Electron构建、browser类型检查、现有Windows静态/包脚本                             | Windows原生安装/启动仍需Windows主机；browser类型检查不代表桌面已支持全部浏览器                                  |
| 成品分发、启动与安全说明 | **仍有legacy依赖**，不能因SDK reader存在就称已移除                                                    | 当前成品QA主要覆盖legacy；本轮未打新包                                                | 需统一生产入口、无ninecli包断言、SDK冷启动/恢复冒烟及运行诊断；切换/删除留给后续批准范围                        |

主要依据：`src/main/index.ts`、`sdk-desktop-runtime.ts`、`sdk-app-client.ts`、`ipc.ts`、`vehicle-source.ts`、`telemetry-source.ts`、`travel-source.ts`、`packages/ninebot-client/src/auth-node.ts`、`candidate-session-core.ts`，以及 `AUTH_PHASE1.md`、`DESKTOP_ACCEPTANCE.md`。旧文档“最多20条”与旧“默认SDK”描述不作为当前实现依据。

## 本轮交付：业务读取错误契约

此前五种业务 reader 直接抛 SDK/网络错误。loadVehicleSnapshot 只把 NinebotClientError(upstream) 视为可降级，导致单分区临时失败使整页失败；业务HTTP401也只落到UNKNOWN，无法走既有AUTH_REQUIRED通知和会话读缓存清理。

现所有业务读取通过 normalizeSdkReadError：车辆、状态、电池、月度、详情统一成受控错误；上游描述、请求正文和cause不转发。明确NinebotHttpError(401)归auth；业务403、未知业务码（即便数值401）和普通网络/解析错误归upstream。既有类型化认证/挑战错误及应用自己的错误种类保持。不会自动重试、退出、删除本地凭据或触发新认证。

真实SDK请求构造+注入HTTP失败、真实reader、SDK桌面工厂与IPC的合成集成覆盖：单域503保留另一域、双域失败返回UPSTREAM_ERROR、401禁止部分成功并清理ID/缓存、403/业务码不清会话、月度401沿相同边界传播。原始私有错误标记不会进入IPC结果，旧会话和真实数据未使用。

最终验证：`pnpm run check` 80文件/661测试全部通过，格式/lint/Node与renderer类型通过；`pnpm run build` SDK及main/preload/renderer通过；SDK `typecheck:browser` 通过。定向25测试含原有3项与新增22项。本轮未启动产品窗口或运行真实请求。

## 阻碍移除运行依赖的下一步顺序

1. **SDK月度完整性**：candidate-session-core当前按条数拼页/停止，重复页可能达到times；需补唯一ID、漏页、短页提前停止、月份/汇总分歧、上限与取消。不能以 legacy fallback 掩盖不完整数据。
2. **实际车辆发现与账号缓存**：两服务均成功空数组应返回已连接无车辆；验证新账号/新车型/服务族变化及迟到写入，不依赖运行旧CLI补元数据。
3. **SDK成品链路**：使唯一生产入口和打包/验包/冷启动QA共同不依赖旧二进制；同步诊断界面和第三方清单。当前还未实施，不能只删除extraResources。
4. **必要真实验收与切换决定**：在允许的独立流程补SMS、自然刷新及Windows/SDK成品；不篡改expiry或把无刷新事件当失败。普通默认切换、删除旧依赖和发布不在本轮执行范围。

分发依赖准确位置：package.json的dev/preview、package/release脚本仍prepare-ninecli-runtime，extraResources仍含二进制；index.ts有默认legacy/hybrid分支；verify-package.mjs、verify-package-windows.mjs要求文件/哈希；qa-packaged.mjs只接受0.1.7/verified；SDK诊断binary=unsupported与SecuritySheet的旧二进制说明也需调整。THIRD_PARTY_NOTICES的“不再分发”描述与当前配置不一致，最终成品清理时必须纠正。

## 来源校验更正

不存在先前报告的macOS哈希冲突：原文件SHA256 `2d8aef91a74275528c995217fc7a56e5e2507d069acbd28f340e0aa573908f0a`匹配准备脚本；运行时对Mach-O签名归一化后SHA256 `70ba65c63a09373a6eab63cf96b80cd06fff2fd107dff63e884efafb9b31352c`匹配代码与验包脚本。两值自d701040分别用于不同范围。当前已知文件在两种文件校验范围均匹配，未执行它、下载替换包或修改校验值。任务目录 ninecli-replacement-20261021/distribution-baseline.json保留复算与历史索引；本地未发现wheel，未独立重新核验wheel METADATA。
