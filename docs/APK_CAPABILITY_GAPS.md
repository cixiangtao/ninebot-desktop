# 官方 APK 能力差异与首个只读增量（2026-10-21）

本轮范围是已有官方分发 APK 的静态证据与当前实现差集，不是全 APK 协议恢复。基线为 `c433069`；不执行 APK、不使用真实凭据、不请求线上接口、不改变当前隔离验收实例 PID 21819。本文的“高”指静态调用/模型证据强度，不代表真实服务已经通过。

## 来源与目标关系

- 目标是 Electron/TypeScript 仓库 `ninebot-desktop`；SDK 是其 workspace 包 `packages/ninebot-client`（`@jiuhao/ninebot-client`）。
- ninecli 是外部 PyPI 0.1.7 wheel 内的兼容运行时，准备脚本为 `scripts/prepare-ninecli-runtime.mjs`；本仓库没有它的 Go 源码。已知随包 macOS 二进制的 Go buildinfo 为 `gitea.com/ninebot/cli`、`go1.25.0`、`darwin/arm64`、`v0.0.0-20260701232148-3ec468a5a739+dirty`。模块名不证明作者或官方归属，wheel 名也不证明核心程序使用 Python。
- ninecli 曾用于历史行为/协议对照；官方 APK 是另一份独立证据。新 SDK 的国家目录不调用 ninecli。
- 当前 `src/main/sdk-desktop-runtime.ts` 只有显式 `NINEBOT_AUTH_SOURCE=sdk` 才选择 SDK；默认仍是 legacy。`PROTOCOL_RESEARCH.md` 的早期“SDK 默认/删除 ninecli”后来已回退；`THIRD_PARTY_NOTICES.md` 的不再分发描述与当前 package 配置不一致，不能作现状依据。本轮不改默认入口。

## 证据身份与覆盖边界

官方分发链、DEX 恢复过程参见 [既有刷新字段证据](AUTH_REFRESH_APK_EVIDENCE.md)。本轮复算文件 SHA256：

| 文件                             | 字节数    | SHA256                                                             |
| -------------------------------- | --------- | ------------------------------------------------------------------ |
| `cn.ninebot.ninebot-6.10.12.apk` | 319870179 | `6ac8bfb50504a7bef741b74fe9c7f6399985f19bd9afecfddcc924cee7dc7f8c` |
| `classes-complete.dex`           | 114690844 | `db87f85c916921a5edd71d63d8c5f7c7059fde0be291b0959f41028fe0218bcc` |

签名证书指纹未独立核验。Passport 区域 base `51233168`，含 2269 类、18673 method IDs；30251 个字符串中 29255 个 ID 可直接核对、996 个由 string_data 顺序恢复。国家路径属于恢复前缀，路径证据应保留此限制。另一个 region `73879344` 解析失败，不能从缺少引用断言 APK 不支持某能力。

使用已有 Python DEX 解析器顺序解码方法、解析 Retrofit/Gson/Signature 注解；**没有 REA/Hopper 成功运行证据**。REA MCP 未暴露、JADX 未配置；未安装工具或重试先前失败的 Hopper。下列偏移是该 DEX 文件的绝对字节偏移，不是 REA Evidence ID。

## 能力差集

| 能力                                                  | APK 静态依据 / 置信度                                                                       | 当前 SDK、CLI、桌面                                                   | 只读边界                                     | 自动 / 真实验证                                                                  | 优先级                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------ |
| 国家与国际区号目录                                    | 1745/1746→1570；四种 v4/v5 路径、参数和响应注解，详见下文 / 高（路径有恢复限制）            | 基线均缺失；本轮新增独立 SDK 入口，桌面仍手工输入区号                 | 只读推断；不接受账号或位置                   | 本轮 28 项合成回归；未请求线上                                                   | P1，本轮完成                   |
| 密码/SMS 登录、恢复、刷新、profile、退出              | 已有刷新证据文档；本轮未重复恢复所有请求 / 已有证据                                         | SDK auth、Passport、Node store；ninecli 包装登录/whoami；桌面已接入   | 登录/退出/刷新会产生或改变会话，不归为只读   | auth-node/passport-sms 等已有测试；真实恢复/profile 曾通过，真实自然刷新仍无证据 | 已有，不重复实现               |
| 车辆、自有/共享、服务族                               | 本轮未恢复车辆区域 / 未评估                                                                 | `vehicle-node.ts`、聚合 candidate-session；CLI vehicles；桌面车辆列表 | 读取                                         | 已有 vehicle/candidate 测试；已有单账号实测记录，不推广多车型                    | 已有                           |
| 状态、电池                                            | 本轮未恢复对应 APK 完整链 / 未评估                                                          | `telemetry-node.ts`；CLI status/battery；桌面状态/BMS                 | 读取；控制指令不在该范围                     | 已有加密完整请求回路测试、历史单账号对照                                         | 已有                           |
| 月度行程、详情、位置、地图、本地统计/导出             | 本轮未恢复对应 APK 完整链 / 未评估                                                          | travel-node、分页、授权位置、地图及本地派生功能均已有                 | 位置/行程含个人信息；导出是本地功能          | 已有 travel/缓存回归；历史月度/详情实测通过。不是本轮新实测                      | 已有                           |
| 当前 IP 所属国家                                      | `$15.call` 1558，`52264480`，POST `/v4/ipseachCountryInfo`、空参数 / 高                     | 未见独立公开 SDK/CLI/桌面入口                                         | 静态只读，但含 IP 国家推断                   | 无新增自动或真实验证                                                             | P3，不顺带调用                 |
| 生物识别注册设备列表                                  | `$20.call` 1579，`52265944`，POST `/biometric/device/list`，userUuid/deviceUuid / 高        | 未见独立公开入口                                                      | 读取账号设备资料，需身份材料                 | 无新增自动或真实验证                                                             | P3，先确定产品需求与授权       |
| 注册、密码重置、改邮箱/手机、解绑、移除设备、上传文件 | PassportApiClient 1796–1824 中的相应命名及请求链；具体动作需逐项恢复 / 分类高、完整协议不足 | 不作为本轮新功能                                                      | 有副作用                                     | 静态分类；未执行真实请求                                                         | 不执行                         |
| 开锁、启停、绑定、付费、固件升级、故障/告警历史等     | 本轮 Passport 区域不足以证明完整协议 / 未知                                                 | CLI bell/buck/engine-start/stop 已明确排除；不能由名字猜新增接口      | 控制/付费/升级有副作用；历史查询也需单独证实 | 未实现、未验证                                                                   | 先恢复调用链和模型，不能猜接口 |

已有能力的主要源码依据：`auth.ts`、`auth-node.ts`、`candidate-session-core.ts`、`vehicle-node.ts`、`telemetry-node.ts`、`travel-node.ts`；ninecli 固定允许命令见 `src/main/ninecli.ts`。真实验收记录见 `AUTH_PHASE1.md` 与 `DESKTOP_ACCEPTANCE.md`，其旧 PID 记录不能自动证明 PID 21819 当前状态。本轮未读取会话或重新核验实例。

## 国家目录的直接协议证据

- `PassportApiClient.getCountryList` 1745（`52272984`）将中文排序默认置 false；1746 建立 `$19`，由 `call` 1570（`52265464`，102 code units）构造请求。
- `enableNewApi` 来自 accessor 1678（`52271760`）。true：`/v5/country_mutil_c.json` 或 `_cn.json`；false：同名 `/v4/`。`mutil` 为原拼写，未修正。
- 唯一业务参数为 `v`，Java int 转十进制字符串。新版 service 1830：POST + JSON body，`@POST` 绝对偏移 `54117517`，Content-Type 注解 `54117505`；旧版 1831：GET + QueryMap，`@GET` 偏移 `54117459`。
- 1570 调用 `generateHeaders` 1736（`52278204`），不显式调用 Authorization 生成器；这不能证明服务端必然匿名可用或底层拦截器没有额外策略。
- 签名 1739→2105（`52288736`）→2100/2106/2097：排序后原值 key=value，用 & 连接；2107 对 UTF-8 做 SHA-256，经 2104/2101/2102 输出小写 hex。新实现复用现有 SDK 的等价 Node/Web signer。SDK 默认 app/client 元数据沿用既有 SDK，不宣称逐值等同该 APK 配置。
- `CountryResultBean` 字段：`resultCode/resultDesc/data`；data.version 是 String；countryList 的泛型是 `Map<String,List<CountryInfoBean>>`，Signature 偏移 `54118555`。1966 `getJson()`（`52284748`）实际读 countryList，字段不叫 json。
- Gson 字段映射：`N→areaCode`（`54118451`）、`C_en→enName`（`54118461`）、`B→isoCode`（`54118471`）、`R→region`（`54118481`）、`C_zh→zhName`（`54118491`）。firstWord/limit 无改名注解，均为 String，不推断手机号长度、服务域等含义。
- 共同 `PassportSubscriber.isSuccess` 1889（`52282228`）比较字符串 90000；未找到 CountryResultBean.getResultCode 的实际调用，**国家接口专用成功策略仍未知**。新客户端保留 resultCode，由调用方明确判断，不把任何 HTTP 2xx 自动归为业务成功。

小型派生证据索引见 [APK_COUNTRY_CONTRACT.json](APK_COUNTRY_CONTRACT.json)。原始解析输出保存在任务目录 `apk-capabilities-20261021/country-contract-methods.json`、`country-annotations.json`；未将 APK、整份 DEX 或凭据加入仓库。

## 本轮交付与可验收范围

`@jiuhao/ninebot-client/passport-country` 提供 `buildPassportCountryListRequest`、`parsePassportCountryResult`、`createNinebotPassportCountryClient`；根导出也可用。客户端只在显式 `list({generation, version, orderByChinese?})` 时访问注入的 transport；沿用现有 fetch origin/redirect 边界，无自动版本回退、重试、持久化、账号或位置访问。

返回 `resultCode` 与可空 data；data 中 version 保持字符串，countriesByGroup 保留服务端分组、顺序和字符串原值。缺失/null 与空对象区分，不能当作“版本未变化”或缓存命中。解码器保守要求已知 String 字段为字符串/null；未知线上形态不会静默强转。resultDesc 不向调用方转发，错误不保留上游文本。

本轮完成 SDK 层能力，不声称桌面已有国家选择器。后续接入登录区号选择前，需要确认线上目录返回、resultCode 策略、v 的版本语义、元数据与匿名访问策略；无须先读取旧账号会话。下一步线上契约验证应限定为既有服务上的公开目录，不以真实个人位置/手机号作测试；本轮未执行。

回归：28 项定向离线测试通过；覆盖四种请求路径、Node/Web 签名、GET 无 body、POST 参数、取消信号、分组字段映射、字符串保真、空数据、无原型污染、HTTP/JSON 错误、gzip 解码、一次调用无回退，以及现有 fetch 边界的合成请求回路。最终 `pnpm run check` 全部通过（79 文件 / 639 测试，格式、lint、类型检查无新增警告），`pnpm run build` 与 `typecheck:browser` 均通过。期间发现并修复了新模块类型引用间接引入 Node 协议实验室的问题；最终 Passport 传输边界可独立用于可移植 SDK。未把合成 fixture 称为真实响应。

## 独立发现与后续顺序

更正（2026-10-21）：此前把原文件 SHA256 与 macOS 代码签名归一化 SHA256 当成同一范围，误判为校验不一致。已知随包文件原始 SHA256 为 `2d8aef91a74275528c995217fc7a56e5e2507d069acbd28f340e0aa573908f0a`，匹配准备脚本；按 `src/main/ninecli.ts` 的 normalizeMacOsCodeSignature 清除签名相关字段并截去签名后，SHA256 为 `70ba65c63a09373a6eab63cf96b80cd06fff2fd107dff63e884efafb9b31352c`，恰好匹配运行时及包验证脚本。两种基线由 d701040 同时引入，不构成来源或完整性冲突。本轮只读复算，未执行二进制，也未改校验值。

随包代码校验没有需要修复的哈希不一致；不应修改预期哈希或绕过完整性检查。

## 同日后续：车辆业务候选

后续研究恢复四段旧 map 扫描遗漏的 DEX，找到按 PN 查询部件信息的请求、模型与调用链，同时证实其必经安全 SDK 加密链。动态 host、实际配置与 wire 兼容性仍未充分确认，本轮未新增猜测客户端。具体差集、偏移、恢复限制与下一步见 [车辆只读研究](APK_VEHICLE_READ_RESEARCH.md)。
