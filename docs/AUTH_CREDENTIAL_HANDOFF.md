# 本地凭据交接：Keychain 入口与边界

2026-10-20 最新状态：用户自行新增九号专用传统 login 条目，并报告 Keychain 取用后 v3 `authentication` / `ebike` / `password` 验收 overall passed，login、profile、restore、refresh、restore-refreshed、profile-refreshed、logout 七阶段全部通过；刷新诊断为 snake-case、HTTP 200。

来源为主对话 `01a15445-dbe5-747e-b370-4757dc0bf0eb` 转交的用户反馈。用户先报告 `keychain-cancelled`，随后说明确认输入多了空格，修正后报告成功。这条已解决反馈不需要放宽 `READ ONCE` 精确匹配规则或继续复测。

**这是用户自行执行并报告的 Keychain + 密码认证成功，助手没有读取真实密码、接受系统权限提示、创建/迁移真实条目、调整 ACL 或发起登录。**开发阶段的生产编译、假数据测试与此次用户在线验收来源应分开。此前认证范围和未覆盖项见 [一期认证验收](AUTH_PHASE1.md)。成功不授权助手后续自动读取或无限期登录，也不表示 Passwords/iCloud 可直接访问。

## 可用入口

| 方案                    | 当前状态                                  | 限制                                                                                                  |
| ----------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 私密终端隐藏输入        | `pnpm protocol:auth -- --auth-only`       | 保留原入口；密码不回显，账号/区号仍回显；避免共享 PTY/截图将输入传给模型                              |
| stdin 凭据 JSON         | `--credentials-stdin`                     | 已有功能；原文件可能落盘，不检查文件权限/属主/符号链接，不删除源文件                                  |
| login Keychain          | 新增 `--auth-only --credentials-keychain` | 只读当前用户传统 `login.keychain-db` 内精确 `ninebot.com` 条目，需要账户和类型，以及本地 TTY 单次确认 |
| Passwords / iCloud 密码 | 当前不支持读取                            | 不推断普通 CLI 有权读取其他应用的数据保护钥匙串；不绕过访问组/签名限制，不导出密码库                  |

不要由助手用 `cat`、`security ... -w` 或其他工具先显示密码。秘密进入对话或工具输出后，不能保证从上下文、日志或留存中撤回。

## Keychain 接入方式

实现位于 [auth-keychain.ts](../scripts/auth-keychain.ts)、[原生 helper](../scripts/native/auth-keychain.swift)，CLI 入口为 [auth-acceptance.ts](../scripts/auth-acceptance.ts)。

- 构建：`pnpm build:auth-keychain`。只使用已安装的 Swift 编译器与系统 Security.framework，不安装依赖，不执行 helper，不读任何钥匙串。产物在被 Git 忽略的 `build/generated/auth-keychain/`，不自动构建、下载或打包进入桌面应用。
- `--credentials-keychain` 与 `--credentials-stdin` 互斥，并强制 `--auth-only`。通过 stdin 接收条目选择 JSON；账户、选择信息和密码不放 argv/env。调用者必须自己在私密终端提供选择信息，不把真实凭据交给模型。
- 支持两类：`store: "login", kind: "internet", server: "ninebot.com", protocol: "https" | "http", account: 精确账户`，可补充精确 `path`/`port`；或 `store: "login", kind: "generic", service: "ninebot.com", account: 精确账户`。`areaCode` 默认 `86`，可明确指定。拒绝未知字段、空账户、通配符、其他网站及子域名；不猜测账户或遍历其他网站。`generic` 仅在实际服务属性恰为 `ninebot.com` 时适用。
- 本地 `/dev/tty` 必须输入固定的 `READ ONCE`（无额外前后空格），确认本次读取并将密码发送给九号进行 auth-only 验收；无终端、取消或不同回答均停止。没有无人值守或跳过确认参数。此操作确认不能代替助手在运行前取得对精确目标和用途的授权。
- helper 固定打开当前用户 `~/Library/Keychains/login.keychain-db`；先只查询限定条目的元数据和持久引用，零条停止，多条停止，属性不完全一致停止。唯一匹配才以持久引用和同一组属性读取密码，读取后再次核对属性。保留系统原有访问控制，不解锁、不添加、不更新、不删除、不改 ACL。
- 密码只从 helper 的独立 fd 3 管道进入 Node；helper 不打印 stdout/stderr，调用方也不捕获或转发它们。fd 3 不是管道/套接字时，helper 在访问钥匙串前退出。返回值受大小限制，helper 运行最多 120 秒，异常仅映射固定原因，不输出原始错误、账户、条目或密码。失败后不自动切换其他凭据来源、不重试。
- 真实验收会执行既有 login/Business/profile/restore/refresh/logout，密码按协议经 HTTPS 发送给九号，且临时会话 token 会按既有实现落盘并在受控完成/失败时清理。仅模型不接收秘密，不是“秘密从未离开内存”。

Apple 的传统钥匙串 ACL 决定系统是否弹框；已有信任可能不弹框。代码不能保证每次显示系统认证框，因此额外要求本地单次确认。若系统显示权限选项，按本次授权选择单次允许；本实现不请求或配置 Always Allow。重编译可能改变 helper 身份并重新触发权限判断，未对真实 ACL 验证。

## 后续使用边界

用户已经在本机自行录入账户并报告本次验收通过；无需向模型提供账户或密码，也无需为同一已通过路径再操作。后续若由助手发起真实读取，仍须有该精确条目及本次 auth-only 用途的明确授权，不能把“已添加”或一次成功当作长期自动访问许可。

本次使用范围为读取传统 login 中精确 ninebot.com/账户条目一次，密码经 HTTPS 发送给九号做认证验收，模型只接收脱敏结果；助手未创建/迁移其他条目或配置持续访问。Passwords/iCloud 直读、系统每次弹窗、其他账号、SMS、人机挑战、真实桌面 GUI、车辆/位置/行程及默认运行时切换均不能由本次结果推出通过。

如果其他凭据仅存在于 Passwords/iCloud，当前 helper 不支持直接取用。仍可由用户自行通过原有隐藏输入入口手动使用；不要导出整个库、自动创建副本、迁移到 login 或修改安全设置，除非另有明确授权。

## 仍然存在的保留边界

密码经过 Swift/JavaScript 字符串、JSON 及签名输入副本；对可控管道 Buffer 的覆盖不能证明所有内存、崩溃/系统副本都已清除。Keychain 本身是持久存储，不是一次性文件功能。stdin 源文件如存在，不由 CLI 删除；备份/快照也不因删除自动消失。

默认 provider 不把密码写入 session store，但 [session-store-node.ts](../packages/ninebot-client/src/session-store-node.ts) 会把令牌会话作为 JSON 写入 0600 文件，目录请求 0700。CLI 新建临时目录，输出 passed 前确认删除；SIGKILL、崩溃、断电、删除失败仍可能留下 token 文件。未做完整渗透测试，不承诺“绝不泄露”或可靠介质擦除。

## 验证与官方依据

本轮 `pnpm run check` 已通过：格式、lint、Node/Web 类型检查和 73 个文件 / 576 项测试；`--help` 可由 Node 24 直接执行。生产 helper 编译通过，仅有传统 `SecKeychainOpen` 的 SDK 弃用警告；保留它是为了限定既有 file-based login，未切换到其他钥匙串。

- TypeScript 假 helper 测试覆盖选择范围、唯一凭据来源、确认先于读取、取消/固定失败原因、异常脱敏、返回结构/长度及可控 Buffer 覆盖。
- `node scripts/test-auth-keychain-native.mjs` 编译带 `KEYCHAIN_HELPER_TESTING` 的独立 fixture 二进制；真实 `SecKeychainOpen` / `SecItemCopyMatching` 调用在该构建中被排除。验证元数据先于密码访问、唯一匹配、零/多条、取消/拒绝、属性变化、非法 UTF-8、无私有管道、stdout/stderr 为空。
- 合成 PTY 测试只调用确认函数，覆盖 READ ONCE、拒绝、Ctrl-C 和 EOF 均及时退出；不执行 Keychain helper。该可选原生测试脚本使用本机已有 Swift 和 `/usr/bin/python3`，不安装工具。
- 助手开发验证时仅编译生产 helper，没有执行真实读取。用户后来报告本机 Keychain 取用及认证链路通过，助手未独立观察系统弹窗/ACL 或真实响应；不能据此承诺每次系统认证行为或所有账号可用。

官方依据：[Apple TN3137：Mac 两种钥匙串及 API 边界](https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains)、[SecItemCopyMatching](<https://developer.apple.com/documentation/security/secitemcopymatching(_:_:)>)、[访问组](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps)、[允许应用访问 Keychain](https://support.apple.com/guide/mac-help/allow-apps-to-access-your-keychain-kychn002/mac)、[Passwords 应用](https://support.apple.com/en-us/120758)。macOS 持久引用查询细节另与本机 Apple SDK `Security.framework/Headers/SecItem.h` 核对，使用 `kSecMatchItemList` 限制二次查询。
