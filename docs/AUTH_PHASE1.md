# 一期认证验收（2026-10-20）

最新状态：用户自行运行 v3 auth-only 验收并报告 overall passed，password login、profile、restore、refresh、restore-refreshed、profile-refreshed、logout 七阶段全部通过。**该账号的密码认证 CLI 生命周期已通过；SMS、人机挑战和真实桌面 GUI 仍未验收，一期整体不能据此全部宣布完成。**

来源为用户报告，由主对话 `01a15445-dbe5-747e-b370-4757dc0bf0eb` 于2026-10-20转交；本轮未重新登录或独立观察真实请求，也未保存凭据或原始响应。字段修复与逆向依据见 [官方APK刷新差异](AUTH_REFRESH_APK_EVIDENCE.md)。凭据交接的只读评估见 [本地凭据交接方案](AUTH_CREDENTIAL_HANDOFF.md)。

## 最低验收清单

| 验收项               | 当前实现 / 离线结果                                  | 真实结果                                                                     |
| -------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| 至少一种首次登录方式 | 密码、短信发码和验证码消费已实现                     | 用户报告密码登录通过；SMS未验收                                              |
| Business 身份        | Passport后必须取得独立业务UID，否则不保存会话        | 用户报告login阶段通过，包含Business初始化；原版动态成功回放仍未覆盖          |
| 正确的连接状态       | profile与IPC已有合成回归                             | 用户报告CLI profile及刷新后profile通过；真实桌面GUI未验收                    |
| 失败提示             | 人机挑战、凭据、限流、HTTP和双码冲突已有受控错误回归 | 本次成功流程不覆盖这些失败分支                                               |
| 完整保存与重启恢复   | 原子保存、恢复与材料相等性校验                       | 用户报告restore及restore-refreshed通过；是新管理器恢复，不是桌面进程重启验收 |
| 刷新与继续使用       | 已按官方方法改为snake-case并签实际body               | 用户报告refresh及profile-refreshed通过                                       |
| 退出后无法恢复       | logout后以新管理器确认本地无法restore                | 用户报告CLI logout通过；GUI退出未验收                                        |
| 人机挑战交互         | 能识别并停止，不伪报短信已发；未实现嵌入式挑战完成   | 未验收，仍是独立范围                                                         |

密码路径的一次真实CLI生命周期已有用户报告通过；仍需确认真实桌面按同一会话正确显示连接状态。默认运行时切换尚未据此批准。短信交互触发时不能用修改签名、复用秘密或绕过验证替代正常流程。

## 最小真实验收命令（需要明确授权后由用户执行）

```sh
pnpm protocol:auth -- --auth-only
```

工具在本机终端提示输入账号、国家区号和不回显的密码；不要把密码或验证码写进消息、命令参数、仓库文件或报告。这个命令执行真实密码登录及 Business 初始化、两次资料检查、刷新和两次新管理器恢复，最后退出并确认无法恢复。只访问 Passport 和 Business 认证边界，不发短信、不读取车辆/位置/行程、不调用原版、不读现有账号目录、不自动重试。

临时令牌仅落在新建的权限受限临时目录，正常完成、处理失败或中断后删除；SIGKILL、崩溃、断电可能留临时目录，边界与既有工具相同。报告增加 `scope: "authentication"`，成功只证明该账号的认证范围，不证明车辆数据、原版 parity、所有账号或实际 Electron 窗口通过。未带该参数仍运行原来的完整只读验收，并报告 `scope: "full-readonly"`。

拒绝报告只含固定类别、受限业务码/HTTP 状态；若来自顶层 code，增加 `businessCodeField: "code"`，避免与 resultCode 混淆。不要根据错误码 2 直接认定密码错误或人机验证。`--help` 不询问凭据或请求服务端。

## 桌面接线

默认继续使用旧运行时。显式设置 `NINEBOT_AUTH_SOURCE=sdk` 后，Electron 入口使用 SDK 认证、车辆、状态、电池和行程 reader，共用一个会话管理器，不创建或回退到 ninecli。设置只影响该启动进程，不持久化选择。真实验证时使用独立新目录并保持同一启动配置，避免与现有账号或两种会话格式混用。

获准进行真实桌面验收后，可先构建 SDK，再在本机终端指定独立目录启动：

```sh
pnpm run build:sdk
NINEBOT_AUTH_SOURCE=sdk NINEBOT_CONFIG_DIR=/absolute/path/to/a-new-private-directory pnpm exec electron-vite dev
```

此启动方式不运行 `pnpm dev` 中的旧原版准备步骤。启动前应明确授权真实账号登录、令牌持久化及登录后界面可能自动触发的资料和车辆读取；本次未执行。它也不能替代刷新验收，刷新由上面的最小命令单独确认。

SDK 对无法恢复的本地材料保留文件、显示未连接；不会自动补业务 UID、删除、迁移或覆盖旧会话。对这个未连接状态，只有用户明确发起且两阶段成功的新登录才写入 SDK 会话；已有完整会话的正常刷新仍按生命周期规则保存。旧入口现在要求 access_token、refresh_token、uuid、business_uid 都为非空白字符串；不完整旧配置需要重新登录。字段齐全本身仍不是服务端有效性的证明，连接状态检查随后还需 profile 成功。

## 此前实现阶段的验证与证据范围

- 全量 `pnpm run check`：71 个文件、504 个测试通过，含格式、lint、Node/桌面严格类型。
- 浏览器目标 `pnpm --filter @jiuhao/ninebot-client typecheck:browser` 通过；SDK 与 Electron main/preload/renderer 的 `pnpm run build` 通过；`node scripts/auth-acceptance.ts --help` 通过，未读取凭据或请求网络。
- 实际 Fetch/临时文件/合成加密对端测试覆盖密码两阶段和存储；纯内存测试覆盖返回码/UID 矩阵、SDK 短信与失败；实际 IPC handlers 使用合成 provider 覆盖桌面连接状态和刷新错误。
- 没有使用真实账号执行测试，没有原版运行。本机隔离调查发现 Docker daemon 未启动，未启动它或下载镜像；没有重试旧的 sandbox-exec 拒绝。
- 原版静态及历史回放边界保留在 [Business 离线证据](BUSINESS_OFFLINE_EVIDENCE.md) 和 [结果合同](AUTH_RESULT_CONTRACT.md)。原版 Business 成功全路径仍缺动态证据，TS 合成加密回放不代替它。

本轮本地实现提交：`af7f113` 短信误报、`0c3107e` SDK 短信、`dde8636` 桌面入口、`609d59e` 双码冲突、`2c0439b` 最小验收、`9f55cda` 半成品会话、`bfba1dd` 领域刷新错误。均未推送。

用户v2复测已排除重定向；后续官方APK静态恢复确认并修复snake-case字段，提交9f9aa36。用户现已报告v3密码路径全链路通过，无需为同一已通过路径重复验收；SMS/GUI等边界以上表为准。

## 历史反馈：v1/v2 刷新 90002 的诊断边界

用户报告顺序为 login/profile/restore passed → refresh failed（passport、unknown、90002）→ logout passed。默认 CLI 使用新临时目录，不先恢复旧会话；login 只有密码请求取得令牌、加密 Business 取有效 UID、保存成功才通过。因此这次所输入凭据确实建立了新认证会话，刷新失败不能反推密码错误。restore 逐项比较 accessToken、refreshToken、uuid、expiresAtMs、businessUid，改变其中一项就会在 restore 阶段失败。

刷新请求字段仍为 accessToken/device/refreshToken，device=ANDROID，不带 Authorization。新增固定 fixture 匹配历史原版合成样本的 body 和签名（Evidence ev_b46d71aecaf9ec360d47dbe9349211f533481ac1201acb20873bbc8f43a4e5a8）。这不是本轮原版运行或真实请求逐字节对照；SDK 与原版默认 User-Agent 有已知差异，尚无因果证据，未据此改协议。旧会话曾有 90002/args missing 的历史记录，不能用来认定本次新会话也有同一原因。

本轮修复并不扩大成功码：缺 access/refresh 材料时客户端在本地抛固定错误，验收 reason 为 missing-refresh-material；明确的 args missing 等说明按文本归为 invalid-request，而单独 90002 仍为 unknown。分类现在可读取 resultDesc、desc、message，错误对象只保留固定分类和字段来源，不保留上游说明。缺材料防护不能直接解释本次报告，因为新登录和恢复本就要求并保留了 refresh token。

历史报告增加 diagnostics.version=1；当前为version=3，已含重定向策略与snake-case字段诊断：

- restoredMaterialsMatchSaved：恢复前后五项材料精确一致。
- refreshAttempt：access/refresh 是否非空、是否仍与最初登录一致、有效期状态和距登录完成的粗时间分桶。profile 可能触发自动刷新；令牌与最初登录不同并不等于恢复损坏。
- observedRefreshRequestsBeforeExplicit：默认 transport 实际观察到的先前刷新请求数；测试注入 factory 无法观察时省略，不伪报0。
- request：实际刷新请求的固定字段集合、与恢复会话的材料相等性、device、是否带 Authorization、Content-Type/时间戳/签名格式及固定 User-Agent 类别。signatureShapeValid 仅证明格式，不宣称在线签名正确。
- passportDescriptionSource：服务端说明来自哪个固定字段或 none；不输出文本。

诊断不包含凭据、签名值、令牌哈希/长度、绝对时间或响应原文；没有新请求、延迟、自动重试或接受码变更。请只分享新命令输出的脱敏 JSON，不分享 token 文件、请求抓包或密码。这些历史字段用于当时区分材料/序列化与上游规则；后续已修正字段名，用户v3报告已通过。

本轮验证：71 文件 / 518 测试通过，包括保存的原版合成刷新 fixture、恢复后完整 HTTP 请求、90002 失败不替换会话、错误说明脱敏及诊断隐私。SDK 本地修复提交 8b439f3，验收诊断提交 22c82f4。
