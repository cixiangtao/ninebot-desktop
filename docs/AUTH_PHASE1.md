# 一期认证验收（2026-10-20）

基础请求、两阶段编排和可选择的桌面入口已实现。用户提供的新真实验收已通过密码登录、Business、资料与恢复，但刷新返回 90002，**完整认证生命周期尚未通过，一期不能宣称已完成**。本轮代理没有读取密码/真实令牌、发送请求或启动桌面应用及原版；真实结果由用户自行运行后提供。

## 最低验收清单

| 验收项               | 当前实现 / 离线结果                                                                                     | 真实结果                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 至少一种首次登录方式 | 密码、短信发码和验证码消费请求已实现；两条保存的原版合成短信请求签名 fixture 匹配                       | 未验证                                         |
| Business 身份        | Passport 成功后必须完成加密 Business 登录，取 data.uid；失败不保存新 SDK 会话                           | 用户报告 Business 初始化通过；仍无原版成功回放 |
| 正确的连接状态       | 旧入口不再把 exit0/90202 当发码成功，也不接受缺业务 UID 的半成品会话；SDK 未登录映射为 connected:false  | 未验证真实桌面                                 |
| 失败提示             | 明确描述的人机验证、凭据错误、限流和 HTTP 错误映射为受控提示；未知码不猜含义；拒绝 code/resultCode 冲突 | 未验证本次账号的实际拒绝原因                   |
| 完整保存与重启恢复   | SDK 原子文件保存、两种格式退出清理及临时目录测试；实际 IPC handlers 用内存替身验证生命周期              | 用户报告新会话恢复通过；真实桌面未验证         |
| 刷新与继续使用       | 刷新合并、保留业务 UID、刷新落盘、领域请求共用新鲜会话；刷新鉴权失败向 IPC 传递 AUTH_REQUIRED           | 用户报告刷新失败：90002 / unknown              |
| 退出后无法恢复       | SDK 和旧入口的本地清理已有回归                                                                          | 未验证真实桌面                                 |
| 人机挑战交互         | 能识别并停止，不伪报短信已发；未实现嵌入式挑战展示/完成/凭证回传                                        | 若账号强制要求此流程，仍是独立阻碍             |

一期至少需要一次真实完整认证生命周期通过，并确认桌面能按同一会话正确显示连接状态；只有此后才讨论默认运行时切换。短信交互触发时不能用修改签名、复用秘密或绕过验证替代正常流程。

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

## 本轮验证与证据范围

- 全量 `pnpm run check`：71 个文件、504 个测试通过，含格式、lint、Node/桌面严格类型。
- 浏览器目标 `pnpm --filter @jiuhao/ninebot-client typecheck:browser` 通过；SDK 与 Electron main/preload/renderer 的 `pnpm run build` 通过；`node scripts/auth-acceptance.ts --help` 通过，未读取凭据或请求网络。
- 实际 Fetch/临时文件/合成加密对端测试覆盖密码两阶段和存储；纯内存测试覆盖返回码/UID 矩阵、SDK 短信与失败；实际 IPC handlers 使用合成 provider 覆盖桌面连接状态和刷新错误。
- 没有使用真实账号执行测试，没有原版运行。本机隔离调查发现 Docker daemon 未启动，未启动它或下载镜像；没有重试旧的 sandbox-exec 拒绝。
- 原版静态及历史回放边界保留在 [Business 离线证据](BUSINESS_OFFLINE_EVIDENCE.md) 和 [结果合同](AUTH_RESULT_CONTRACT.md)。原版 Business 成功全路径仍缺动态证据，TS 合成加密回放不代替它。

本轮本地实现提交：`af7f113` 短信误报、`0c3107e` SDK 短信、`dde8636` 桌面入口、`609d59e` 双码冲突、`2c0439b` 最小验收、`9f55cda` 半成品会话、`bfba1dd` 领域刷新错误。均未推送。

用户v2复测已排除重定向。后续REA技能调查从官方APK实际方法确认refresh body应为access_token/refresh_token，已修正原版复刻的camel-case字段，并将诊断升v3。当前依据和验收边界以 [官方APK刷新差异](AUTH_REFRESH_APK_EVIDENCE.md) 为准；真实刷新尚未重验，一期仍未完成，不要求用户取得官方示例。

## 新真实反馈：刷新 90002 的诊断边界

用户报告顺序为 login/profile/restore passed → refresh failed（passport、unknown、90002）→ logout passed。默认 CLI 使用新临时目录，不先恢复旧会话；login 只有密码请求取得令牌、加密 Business 取有效 UID、保存成功才通过。因此这次所输入凭据确实建立了新认证会话，刷新失败不能反推密码错误。restore 逐项比较 accessToken、refreshToken、uuid、expiresAtMs、businessUid，改变其中一项就会在 restore 阶段失败。

刷新请求字段仍为 accessToken/device/refreshToken，device=ANDROID，不带 Authorization。新增固定 fixture 匹配历史原版合成样本的 body 和签名（Evidence ev_b46d71aecaf9ec360d47dbe9349211f533481ac1201acb20873bbc8f43a4e5a8）。这不是本轮原版运行或真实请求逐字节对照；SDK 与原版默认 User-Agent 有已知差异，尚无因果证据，未据此改协议。旧会话曾有 90002/args missing 的历史记录，不能用来认定本次新会话也有同一原因。

本轮修复并不扩大成功码：缺 access/refresh 材料时客户端在本地抛固定错误，验收 reason 为 missing-refresh-material；明确的 args missing 等说明按文本归为 invalid-request，而单独 90002 仍为 unknown。分类现在可读取 resultDesc、desc、message，错误对象只保留固定分类和字段来源，不保留上游说明。缺材料防护不能直接解释本次报告，因为新登录和恢复本就要求并保留了 refresh token。

上一版报告增加 diagnostics.version=1（当前 version=2 另见上面的重定向说明）：

- restoredMaterialsMatchSaved：恢复前后五项材料精确一致。
- refreshAttempt：access/refresh 是否非空、是否仍与最初登录一致、有效期状态和距登录完成的粗时间分桶。profile 可能触发自动刷新；令牌与最初登录不同并不等于恢复损坏。
- observedRefreshRequestsBeforeExplicit：默认 transport 实际观察到的先前刷新请求数；测试注入 factory 无法观察时省略，不伪报0。
- request：实际刷新请求的固定字段集合、与恢复会话的材料相等性、device、是否带 Authorization、Content-Type/时间戳/签名格式及固定 User-Agent 类别。signatureShapeValid 仅证明格式，不宣称在线签名正确。
- passportDescriptionSource：服务端说明来自哪个固定字段或 none；不输出文本。

诊断不包含凭据、签名值、令牌哈希/长度、绝对时间或响应原文；没有新请求、延迟、自动重试或接受码变更。请只分享新命令输出的脱敏 JSON，不分享 token 文件、请求抓包或密码。当前真实 90002 根因仍未定位；先用这些字段区分本地材料/序列化问题与尚待确认的上游规则。

本轮验证：71 文件 / 518 测试通过，包括保存的原版合成刷新 fixture、恢复后完整 HTTP 请求、90002 失败不替换会话、错误说明脱敏及诊断隐私。SDK 本地修复提交 8b439f3，验收诊断提交 22c82f4。
