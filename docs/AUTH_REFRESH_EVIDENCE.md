# 刷新 90002：v2 结论与最小取证方案

后续已按用户请求使用本机REA技能继续静态逆向，从官方APK实际方法恢复snake-case刷新字段，已据此修复。当前依据和下一步以 [官方APK刷新差异](AUTH_REFRESH_APK_EVIDENCE.md) 为准。下文保留当时有限网页/原版调查范围，不能继续据此要求用户提供官方示例。

## 当前真实反馈已经排除的假设

2026-10-20 用户提供 v2 报告（message_id `Sentinel_b79e4be7f7708191a26569ce0fba6e44`）：login/profile/restore passed，refresh 为 passport / invalid-request / resultDesc / 90002，logout passed。默认 transport 的 `passportRedirectPolicy=reject`，刷新直接 `response.httpStatus=200`。因此本次 HTTP 自动重定向假设已经排除；不要要求用户再次运行同一验收。

同一报告还确认：access/refresh 非空、仍与新登录一致，restore 五项材料一致；fresh / under-10s，之前观察到的 refresh 请求数为 0。它排除已观察边界内的材料缺失、恢复变化和之前自动刷新，**不证明请求合同完整、签名在线正确，或服务器允许 fresh token 立即 refresh**。

密码登录及资料读取成功不能代替 refresh 成功。一期仍未完成；不通过重新密码登录、忽略刷新失败、接受 90002、延长等待后直接判通过等方式降低标准。

## 新增官方公开代码核查

本轮只下载并静态阅读官方账号登录页已引用的资源，没有登录、执行下载代码、调用认证 API 或枚举猜测接口。主包及其直接声明的 24 个 JS 资源均已核查；分片继续声明的本地 JS 引用均指向已读资源或主包。没有请求 source map、隐藏文件或私有目录。

可复核的资源清单、SHA256、字节数和关键词统计保存在 [公开资源清单](AUTH_REFRESH_PUBLIC_ASSETS.json)。精确主包来源为：

[官方主包 index-UkJIss_V.js](https://account.ninebot.com/auth-v5/dist/assets/index-UkJIss_V.js)

SHA256 `17e0f5b6e3cda260788056a7c6e17b1e5ea7e93565f5db7f16e56547c819646f`。它的错误字典含 `90002:"缺少参数"` / `90002:"Missing Parameters"`，也含无效 refresh token / refresh token 过期词条；这些是错误含义，不是刷新字段或时机规范。

发现独立的官方网页请求封装：

[官方 code-CJRK5Lz1.js](https://account.ninebot.com/auth-v5/dist/assets/code-CJRK5Lz1.js)

SHA256 `1b71f343838ede9d13f5b8fbc21c45e2c7ba4cc5ffcf0d76df316968c10b9a87`。其中 `le` 将 params/data、timestamp、clientKey、url 合并，按 key 排序，以原始 `key=value` 和 `&` 拼接后 SHA256；请求 interceptor 使用 region、clientId 和毫秒 timestamp，默认 clientId 为 `USER_RIGHTS_CENTER_SELF`，baseURL 为 `/p`。这提供了官方网页登录场景的签名证据，其客户端配置与 App 不同，**不能把网页 clientKey、clientId 或成功码搬到车辆 App 刷新请求**。

主包的 refresh 字样仅出现在错误字典；24 个分片均未发现 refreshToken、refresh_token、`/refresh` 或刷新时机规则。它们包含发码、注册、地区查询等调用，但没有可用的 App refresh 合同。有限的官方域文档检索也未返回相关规范；搜索结果中的割草机扩展口 API 属于另一产品，未当作 Passport 来源继续追查。这里只能说“本轮可访问范围没有找到”，不能宣称官方从未发布。

## 原版恢复与刷新并非权威合同

固定原版 ninecli 0.1.7 ARM64 的 SHA256 仍为 `2d8aef91a74275528c995217fc7a56e5e2507d069acbd28f340e0aa573908f0a`。本轮只复核已保存的反汇编及历史合成报告，未执行二进制或重试 sandbox。

- `cmd.ensureFreshTokens`（`0x100323e50..0x100324200`）先 LoadTokens，解析已保存的 accessTokenValidity；缺失或解析失败的路径跳过自动刷新。整数按 Unix 毫秒转换，在 `0x100323fa8..0x100323fb4` 与 `0x4e94914f0000` 纳秒比较，即 24 小时。此处是 CLI 本地调度策略，不是服务端最小刷新间隔证明，也不能外推至所有 proxy/MCP 路径。
- `Passport.Refresh`（`0x10027e490..0x10027ea90`）构造三字段 JSON 并调用 post；成功数据路径在 `0x10027e78c` / `0x10027e7d4` 只读取 access_token、refresh_token，返回两个字符串，不返回新 UUID 或有效期。
- `cmd.ensureFreshTokens` 在 `0x100324058..0x100324094` 只替换这两个令牌后 SaveTokens。若服务端返回新有效期，它在此路径也不会更新；保留旧的过期时间可能让后续调用继续进入刷新。这是静态可见的生命周期局限，不能据此推断本次 90002 缺哪个请求字段。
- 历史合成回放 `11-refresh-rotated-uuid`（Evidence `ev_b46d71aecaf9ec360d47dbe9349211f533481ac1201acb20873bbc8f43a4e5a8`）同样保存了旧 UUID/有效期；只证明原版对受控假响应的行为，不能证明真实服务端接受过它。原版已有漏检数值 resultCode 等错误判定缺陷，详见 [结果合同](AUTH_RESULT_CONTRACT.md)。

SDK 当前 `parsePassportRefreshSession` 会使用明确返回的新 UUID/有效期，仅在服务端省略时保留旧值。无需照搬原版遗漏，也没有依据改端点、设备、字段或签名。当前证据不足以认定原版请求一定完整，或一定错误。

## 当时的用户配合备选（已由后续APK恢复替代）

普通 App 界面通常无法给出可靠请求字段及签名规则；当前限制下不安排代理拦截或从账号数据提取。因此不让用户凭界面猜字段，也不要求等待后反复重试。以下两条任选其一取得新来源即可：

1. **优先索取官方合同。** 用户可通过已经使用的官方客服/开发者支持渠道转交下面的问题，只回传公开规范或用占位符写成的答复。本代理不代发消息。第一轮只需官方回答刷新时机以及当前请求是否缺必填字段；不需要账号标识。
2. **提供具体公开客户端版本。** 若用户有合法获取的官方 Android 安装包来源，只需提供官方公开下载链接、App 名称/版本、Android 或 iOS、服务区域。之后再判断能否安全静态查看请求构造和调度；不需要手机备份、App 数据目录、token 文件或登录。当前没有下载/安装 App，环境只有 unzip，未发现 jadx/apktool，也未安装任何工具；仅 APK 字符串不足以证明完整合同。若只有 iOS 商店版本号且没有合法可读代码，仍需官方规范，不尝试绕过平台保护。

若官方客户端本身提供**明确不含秘密的协议说明或诊断摘要**，可由用户先确认字段范围后仅抄写结构；目前未验证它提供这种功能，不虚构导出步骤。不要传 HAR、原始抓包、证书、代理记录、token、密码、验证码、签名值、JWT 片段或 token 哈希。

可转交官方维护方的问题如下：

> 新密码登录、资料读取和会话恢复均成功；首次 refresh 在登录后不到 10 秒、access token 尚新鲜时，直接 HTTP 200，resultCode=90002，resultDesc 被本地归类为缺少参数。请求 POST /v3/user/refresh，JSON 键为 accessToken、refreshToken、device，device=ANDROID，不含 Authorization；客户端元数据为 vehicle_app_prod / app_version 610063322 / Android / os_version 13 / zh-hans-cn。请确认该客户端当前是否受支持、令牌未到期时是否允许立即刷新，以及最小间隔或必要前置条件；若仅到期附近允许，请给出规则，不需要账号排查。
>
> 请提供用占位符表示凭据的成功请求结构：方法与区域端点、必填 body 字段和类型/编码、必填 header 名称及公开客户端元数据、timestamp 单位、签名覆盖字段/排序/转义/编码规则，以及成功响应字段/类型和令牌轮换规则。不需要实际密码、token、签名或任何用户标识。若有公开规范/官方代码，请提供链接及版本。

只有“别的实现也发送相同字段”或“签名看起来是 SHA256”不够。应先由新规范/官方请求构造形成一个具体差异，再用占位符做离线 golden fixture；真实刷新验证保持独立，不能由再次登录顶替。如果官方确认立即刷新不被支持，再据明确时机规则设计一次完整生命周期验收，不预先放宽标准。

## 本轮范围与剩余阻碍

本轮仅公开静态源码审计、旧静态/合成证据复核、仓库文档更新；运行时源码未修改，未重复执行真实验收、未触碰现有令牌、未安装工具或证书。公开资源原文与本机证据摘要保存在任务目录 `refresh-independent-20261020/v2-followup/`，仓库只保留出处/摘要，避免复制第三方源码。

运行时修复先前已通过 72 文件 / 535 测试及构建，不能把它写成本轮重新执行或在线刷新通过。本轮文档执行格式检查及 diff 检查。没有新的权限拒绝/待审批动作；阻碍是缺少官方 App 刷新成功合同及立即刷新时机规则。有限调查至此收束，等待上述新证据，而非继续同源搜索或猜字段向真实服务发送请求。
