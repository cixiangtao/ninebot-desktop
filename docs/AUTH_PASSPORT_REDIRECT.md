# Passport 重定向保护与一次针对性验收

本地修复提交 `c47d03a`。这修复了一个可独立复现的传输缺陷；尚无证据表明它是用户真实 refresh 返回 90002 的根因。本轮没有真实认证、读取/使用已有 token、运行原版程序或重试原隔离拒绝。

## 行为与兼容性范围

共享 `createFetchNinebotTransport` 对 `service: "passport"` 的所有请求（密码/短信认证、profile、refresh）显式使用 `redirect: "manual"`。301、302、303、307、308、浏览器 `opaqueredirect` 或已被自定义 Fetch 跟随的响应，统一抛 `NinebotPassportRedirectError`。错误只包含固定名称、固定消息和受限状态；状态不可见时为 0。丢弃响应体，取消读取时的错误也不透出。不读取 Location，不自动重放或向目标主机发送请求。

原来依赖 Passport 自动跳转的配置现在会明确失败，需要核实固定接口配置后处理，不能自动接受目标地址。车辆、行程、Business 服务和独立的 `transport-web` 行为不变；签名、字段、User-Agent、Authorization、成功码规则都不变。直接返回的 HTTP 200 / 90002 仍然失败。

保证依赖标准 Fetch 遵守 manual 策略。自定义 Fetch 如果无视该策略并已转发，SDK 可以拒绝它的返回值，无法撤回已发生的转发；完全注入的自定义 transport 仍由调用方负责策略。

默认 Fetch 可在 301/302 后将 POST 改成 GET 并移除正文，303 也有方法改写规则；307/308 可能保留正文转发。依据为 [WHATWG Fetch HTTP-redirect fetch](https://fetch.spec.whatwg.org/#http-redirect-fetch)。本机合成基线实际复现了 POST → 302 → 空体 GET → 合成 90002；这只能证明旧诊断存在盲区。

## 新验收的诊断差异

以后由用户自行决定运行一次现有 `pnpm protocol:auth -- --auth-only` 时，默认路径报告：

- `diagnostics.version: 2`。
- `diagnostics.passportRedirectPolicy: "reject"`；如果注入 auth factory 绕过默认 transport 则省略，不能伪报已经保护。
- 跳转被拒绝：对应阶段 `reason: "passport-redirect"`，可见时含固定 HTTP 跳转状态；opaque 状态不输出虚构 HTTP 状态。刷新不会有成功接收的 `response` 观察。
- 直接 HTTP 响应：`diagnostics.refreshAttempt.response.httpStatus` 记录受限状态，不包含正文、headers、URL、Location 或任何秘密。
- 原有发送前字段相等性与形状检查继续保留；这些仍不证明签名在线有效。

若 refresh 报 `passport-redirect`，证明这次请求碰到了 HTTP 跳转，尚需核实正确固定端点；不会自动跟随或发送第二次认证请求。若报告同时有 `passportRedirectPolicy: "reject"`、`refreshAttempt.response.httpStatus: 200`，且 refresh 仍为 `reason: "passport" / businessCode: 90002`，这次请求的 Fetch 自动跳转假设就已排除。不要继续重复相同登录来验证同一假设。

这个工具仍会真实新密码登录、Business 初始化、profile、恢复、显式刷新与本地退出；不访问车辆或行程，不读现有账号目录，无自动重试。本轮代理仅运行了 `--help`，没有运行这项真实验收。

## 若仍直接 90002，缺的最小脱敏证据

需要当前官方 App 真正成功 refresh 的合同或维护方规范，包括：方法、固定域名/路径/区域；body 字段名、类型与编码；设备/客户端公开元数据；必要 header 的名称及静态值、秘密 header 是否存在；timestamp 单位；签名覆盖字段、排序、拼接/转义规则；成功响应字段名/类型、令牌是否轮换。用占位符标记秘密，不提供实际 token、密码、签名、JWT 片段、个人标识、原始抓包或 token 哈希。只有失败请求或同一 ninecli 的再实现，不能充当成功合同。

## 官方错误字典：确切来源与限制

[官方账号登录页](https://account.ninebot.com/login) 引用的公开静态资源：

[https://account.ninebot.com/auth-v5/dist/assets/index-UkJIss_V.js](https://account.ninebot.com/auth-v5/dist/assets/index-UkJIss_V.js)

2026-10-20 下载版本 SHA256：`17e0f5b6e3cda260788056a7c6e17b1e5ea7e93565f5db7f16e56547c819646f`。在资源中搜索 `90002` 可找到中文词条 `90002:"缺少参数"` 及英文词条 `90002:"Missing Parameters"`；90014 另为用户名/密码错误。

它支持错误含义，不提供 `/v3/user/refresh` 的必填字段规范。90002 单独出现的客户端分类仍为 unknown；`invalid-request` 是依据明确描述文本的本地分类，不把数值字典解释强行扩成协议接受/拒绝规则。静态资源可能随官网版本更换；固定下载摘要用于识别本次证据。

公开 [Python 实现 README](https://github.com/malinkang/ninebot-trip-sync/blob/c79f4693757eb1ad0f586567c81c354fde4708ff/README.md) 127–132 行也记录了 best-effort refresh 返回 90002。它使用 `Go-http-client/1.1`，不能据此主张切换 User-Agent 已有成功依据。其“签名被接受”的说法是作者判断，并非成功刷新合同。

## 离线验证

- `pnpm run check`：格式、lint、Node/桌面严格类型通过；72 文件 / 535 测试通过。
- `pnpm --filter @jiuhao/ninebot-client typecheck:browser` 通过。
- `pnpm run build`：SDK 与 Electron main/preload/renderer 构建通过；没有启动应用。
- `node scripts/auth-acceptance.ts --help` 通过，不读凭据或请求服务端。
- 实际 Node Fetch + 自建 loopback 覆盖五种跳转、跨 origin 目标零请求、原请求保持 POST/正文、直接 200/90000 和 200/90002、非 Passport 兼容行为。浏览器 opaque / 不遵守 manual 的自定义 Fetch 采用合成响应测试。
- 验收诊断测试保留实际 Passport parser 和默认 observed transport，替换文件存储、Business 初始化及 Fetch 对端；证明诊断接线和脱敏，不证明真实云端合同。
