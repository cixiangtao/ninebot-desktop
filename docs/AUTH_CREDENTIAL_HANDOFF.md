# 本地凭据交接方案：只读评估

2026-10-20。针对用户“可否将账号密码写在本机文件中，由程序读取但不保留”的可行性问题，仅检查现有源码与官方Keychain文档。**本轮没有读取真实凭据、创建凭据文件/Keychain条目、开发新入口、配置持久访问或发起登录。**用户是在询问方案，不构成保存密码或授权未来自动访问。

## 结论与现有可用入口

可让本地认证程序直接取得凭据，模型只看到固定脱敏结果；不要让助手用cat/read_file等方式读出密码，再承诺从上下文“忘掉”。秘密一旦成为工具输出或消息，就不能保证从对话、日志或留存中撤回。

| 方案                                           | 现状                                            | 建议与限制                                                                                                              |
| ---------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 用户私密终端输入                               | 当前可用：`pnpm protocol:auth -- --auth-only`   | 密码不回显、不进入readline历史；账号和区号仍回显。由用户在自己的终端运行，避免共享PTY转录、屏幕录制或截图进入助手工具   |
| 受限临时文件经stdin进入程序                    | 当前`--credentials-stdin`可用；无需模型读取内容 | 文件内容已落盘，不是零保留；CLI不检查原文件权限、属主、符号链接，也不自动删除输入文件；不能把它称为安全的一次性文件功能 |
| macOS Keychain由专用程序直读                   | macOS具备API；当前仓库未实现接入                | 更适合明确授权的长期本地保存，但Keychain本身就是持久存储；需要开发精确条目读取、受控输出和访问确认，不应自动开永久权限  |
| 直接把凭据回传给助手、放argv/env或打印读取结果 | 不作为此方案                                    | argv、环境、shell历史、工具输出/跟踪都可能增加暴露面，不能用删除源文件消除这些副本                                      |

当前密码CLI路径已经由用户报告通过，不需要为了讨论凭据方案再运行一遍。

## 源码核查范围与实际风险

- [auth-acceptance.ts](../scripts/auth-acceptance.ts) 78–107行：stdin最多16384字符，验证JSON；TTY模式的password输出被muted，historySize=0，但user/areaCode提问未静音。没有承诺账号也隐藏。
- 同文件126–155行：不接受账号密码命令参数；主入口捕获异常后只输出固定phase/reason，不输出JSON解析错误、上游原文或stack。成功报告为白名单诊断，原始密码/令牌不进入报告。
- 密码经JavaScript字符串、JSON请求体与签名输入副本在内存处理；没有显式安全擦除。退出进程不等于可验证地清除所有内存、崩溃/系统副本。输入源文件即便删除，也不能保证备份、快照、编辑器自动保存或存储介质上的残留消失。
- 默认认证provider只构造会话材料，不把密码写入session store。[session-store-node.ts](../packages/ninebot-client/src/session-store-node.ts) 103–114行将令牌会话作为JSON写入权限0600文件，目录请求0700；这些是会话token，不是“从未有秘密落盘”。
- CLI新建临时目录，正常完成/受控失败时退出并删除；输出passed前先确认删除成功。SIGKILL、崩溃、断电、文件系统删除失败仍可能留下临时令牌文件。现有逻辑没有把密码原文件作为清理对象。
- 默认登录请求必须按九号协议经HTTPS把凭据发送到九号服务；“模型看不到”不等于凭据从未离开本地进程。此次没有实际发送。
- 本轮源码范围内未发现Keychain、SecItem、security find/add-generic-password或Electron safeStorage接入。此结论只针对仓库所查路径，不探测本机用户Keychain或其他程序。

静态审查未发现默认主入口主动打印/持久化密码的代码；上述回显、磁盘token和内存副本边界仍真实存在。不是一次完整渗透测试或“绝不泄露”认证。

## 如以后选择文件方案

优先用户直接输入；若确有程序化需求，用户可自行在不进入仓库/云同步的私有目录准备JSON（字段user/password/areaCode），目录0700、文件0600。不要把秘密写在shell命令、echo、heredoc、环境变量或聊天里；也不要让助手读取/预览文件内容。

现有CLI可通过shell输入重定向直接消费文件，命令参数只出现路径；只给出未来用法模板，本轮没有创建文件或执行：

```sh
node scripts/auth-acceptance.ts --auth-only --credentials-stdin < /absolute/private/credentials.json
```

使用前需已有SDK构建。该模板不会删除源文件，也不验证输入文件权限，因此不能满足自动检查/一次性销毁要求；若要这些行为，需要另行设计专用入口并获授权。删除后也不是可靠介质擦除。模型只应接收程序的脱敏JSON报告，不读取输入文件或原始stdout旁路。

## 如以后选择Keychain方案

可以设计专用本地helper：用户通过系统UI写入一个精确服务/账号条目；helper用SecItemCopyMatching仅查询该条目，经用户确认后直接在进程内交给认证模块，或经不被工具转录的私有管道交给CLI；输出只允许现有脱敏报告。不要先用`security ... -w`把密码作为工具输出显示出来，也不应向通用Terminal/Node或所有应用授予无差别永久读取权限。

Apple说明Keychain访问可选择Deny、Allow Once或Always Allow。需要一次性操作时优先逐次确认，不能把用户这次询问解释为Always Allow。保存到Keychain是有意保留，删除文件不等于删除Keychain条目；后续重用、撤销和会话token保留策略必须分别明确。

真正实现前至少明确：一次性读取还是长期保存；允许的账号条目及认证/读取操作范围；是否每次用户确认；原文件/Keychain条目/会话token分别由谁保留和清理。只同意开发入口，不自动等于同意写入真实密码或运行登录。当前不创建该helper，也不请求用户现在提供秘密。

## 官方依据与本轮验证

- [Apple：使用Keychain管理用户秘密](https://developer.apple.com/documentation/security/using-the-keychain-to-manage-user-secrets)
- [Apple：SecItemCopyMatching](<https://developer.apple.com/documentation/security/secitemcopymatching(_:_:)>)
- [Apple：允许应用访问Keychain](https://support.apple.com/guide/mac-help/allow-apps-to-access-your-keychain-kychn002/mac)

本轮只读源码核查与文档格式/链接/diff检查；没有重复真实认证，也未重跑此前72文件/535测试。用户v3密码路径通过的来源与未覆盖范围见 [一期认证验收](AUTH_PHASE1.md)。
