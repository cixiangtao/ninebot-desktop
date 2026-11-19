# 以桌面实际能力替代 ninecli（2026-10-21）

用户已明确：目标是 ninebot-desktop 所需能力和移除 legacy 运行依赖，API 可以重设计；不要求兼容 ninecli 的命令、flags、默认参数、JSON 文案或退出码。不为未使用的控制指令或全部官方 App 能力补实现。APK 只在核对本项目所需协议时使用；部件查询扩展暂停，不是替代前提。

当前普通入口仍默认 legacy，`NINEBOT_AUTH_SOURCE=sdk` 明确 opt-in。此轮不切默认、不删除旧版本、不推送、不操作 PID21819 或真实会话。SDK 的应用合同是 `NinebotAppClient` 与 renderer IPC，而不是子进程输出。

## 可核验的必要能力矩阵

“已有”指代码实现存在；自动合成通过、历史真实证据与待真实验收分别列出，不相互替代。历史真实结果来自既有验收记录/用户反馈，本轮未重新请求或观察实例。

| 必需流程                 | SDK / 桌面实现与自身合同                                                                              | 自动证据                                                                                   | 真实证据与剩余缺口                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| 密码登录与连接状态       | auth-node 的 Passport→Business 两阶段，只接受完整会话；失败不替换旧会话；SDK app client→IPC           | auth-node、auth-result、sdk-desktop-runtime 测试                                           | 用户报告密码验收七阶段通过；独立 SDK 桌面登录曾通过，不推广所有账号/车型                                           |
| 恢复、刷新、退出         | SDK store、并发刷新/替换竞态、显式退出；桌面 legacySession=ignore，不依赖运行 ninecli 或读取旧 tokens | auth、store、auth-node、桌面合成生命周期及恢复→业务→刷新回归                               | SDK恢复/profile已有实测；真实自然刷新和当前窗口的完整退出/重登仍待验收。切换时需明确保留旧文件、SDK重新登录策略    |
| 短信与挑战               | SDK发码/消费及Business初始化；挑战受控报错，不虚报成功；旧表单晚到响应忽略                            | passport-sms、sms-login-flow、离线 Electron QA                                             | 真实 SMS 未验收；内嵌挑战未实现，保留受控边界，不绕过验证                                                          |
| 车辆（自有/共享）        | vehicle-source及SDK车辆客户端；发现ebike/motor；输出自有VehicleSummary/opaque ID                      | vehicle-source、vehicle-node、SDK缓存隔离及IPC空车辆回归                                   | 历史单账号车辆通过；空车辆、跨账号/区域与新增服务族现已离线通过，尚待真实账号验收                                  |
| 状态、电池、位置         | telemetry SDK、BMS/锁/点火/续航/充电解析，按需授权位置；不包含控制操作                                | telemetry-node、分区快照、位置桥接与本轮真实reader→IPC合成测试                             | 历史五类读取及位置桥接记录不等于所有车型通过；错误契约与本轮缓存隔离尚未加载进当前实例                             |
| 月度行程、详情、分页     | travel SDK及candidate-session全月分页，桌面RideMonth/RideDetail；本地统计/回放/导出复用结果           | travel-node、travel-pagination新增44项完整性回归、parsers/统计/IPC                         | 月度/详情历史实测通过；分页完整性与本轮账号缓存隔离离线通过，尚无真实跨页服务验收                                  |
| 错误与会话失效           | 自有NinebotClientError→IPC；明确HTTP401与既有auth错误通知重新登录；临时错误允许分区降级               | **已完成7a5740a** sdk-app-client及sdk-read-error-integration；覆盖403/未知业务码不误判auth | 合成回归通过；不等于本轮真实401或服务故障验收                                                                      |
| 缓存、刷新、取消         | IPC TTL、并发合并、手动绕缓存、失效清理及迟到结果保护；无需旧进程                                     | session-read-cache、sdk-read-diagnostics、sdk-vehicle-cache-isolation及存储取消测试        | 账号/区域持久元数据隔离与迟到结果保护离线通过；缓存命中不证明新网络读取或自然刷新                                  |
| 跨平台运行、离线构建     | Node/TS SDK，无Python/Go子进程需求；同一应用合同可用于macOS/Windows                                   | SDK/Electron构建、browser类型检查、现有Windows静态/包脚本                                  | Windows原生安装/启动仍需Windows主机；browser类型检查不代表桌面已支持全部浏览器                                     |
| 成品分发、启动与安全说明 | 默认仍保留legacy；新增独立SDK-only入口和无旧运行时的opt-in成品                                        | SDK-only实际ASAR/资源/签名/fuse验包及成品main/preload离线harness                           | Mac arm64成品真实Electron后台启动/renderer/preload/IPC已通过；视觉/真实账号、Windows与正式分发仍待验收；未默认切换 |

主要依据：`src/main/index.ts`、`sdk-desktop-runtime.ts`、`sdk-app-client.ts`、`ipc.ts`、`vehicle-source.ts`、`telemetry-source.ts`、`travel-source.ts`、`packages/ninebot-client/src/auth-node.ts`、`candidate-session-core.ts`，以及 `AUTH_PHASE1.md`、`DESKTOP_ACCEPTANCE.md`。旧文档“最多20条”与旧“默认SDK”描述不作为当前实现依据。

## 已交付：业务读取错误契约（7a5740a）

此前五种业务 reader 直接抛 SDK/网络错误。loadVehicleSnapshot 只把 NinebotClientError(upstream) 视为可降级，导致单分区临时失败使整页失败；业务HTTP401也只落到UNKNOWN，无法走既有AUTH_REQUIRED通知和会话读缓存清理。

现所有业务读取通过 normalizeSdkReadError：车辆、状态、电池、月度、详情统一成受控错误；上游描述、请求正文和cause不转发。明确NinebotHttpError(401)归auth；业务403、未知业务码（即便数值401）和普通网络/解析错误归upstream。既有类型化认证/挑战错误及应用自己的错误种类保持。不会自动重试、退出、删除本地凭据或触发新认证。

真实SDK请求构造+注入HTTP失败、真实reader、SDK桌面工厂与IPC的合成集成覆盖：单域503保留另一域、双域失败返回UPSTREAM_ERROR、401禁止部分成功并清理ID/缓存、403/业务码不清会话、月度401沿相同边界传播。原始私有错误标记不会进入IPC结果，旧会话和真实数据未使用。

该增量验证：`pnpm run check` 80文件/661测试全部通过，格式/lint/Node与renderer类型通过；`pnpm run build` SDK及main/preload/renderer通过；SDK `typecheck:browser` 通过。定向25测试含原有3项与新增22项。本轮未启动产品窗口或运行真实请求。

## 已交付：SDK月度分页完整性（0fb7870）

先新增失败测试，在原实现运行43项，35项失败、8项通过（记录保留于任务目录 `ninecli-replacement-20261021/pagination-red.log`）。修复后新增44项离线测试全部通过，未使用真实账号或请求。

全月模式现在逐页核对请求月份、成功状态、非负安全整数总条数，以及数值归一化后的时长、里程、能耗汇总；接受可选汇总为空、成功响应无外层code。使用与桌面解析一致的字符串ID别名及去空格规则，拒绝重复页、跨页重叠、页内重复和无效ID。总数未满足时的短页、超过声明条数、分页期间汇总变化及100页上限均受控失败，不返回部分全月结果，不用legacy补偿。每次响应后检查取消，忽略会话清理或调用方取消后迟到的第一页/末页。

完整性承诺基于上游声明的总数与各页一致性，不能证明上游一致漏报的记录。全月模式遇到未知总数或数据变化会报错；调用方可重新读取。显式单页模式保留原始第一页语义，不宣称全月完整。尚未在真实服务验证跨页读取。

验证：分页与现有candidate-session定向3文件/56测试通过；`pnpm run check` 81文件/705测试、格式/lint/Node和renderer类型全部通过；SDK `typecheck:browser` 和 `pnpm run build`（SDK及main/preload/renderer）通过。本轮没有启动窗口，PID21819、真实会话、legacy默认和分发依赖均未改动。

## 已交付：无车辆冷启动与账号元数据隔离（906dcb8、030c827）

先新增合成数据失败复现：桌面读取链路16项中15项失败、1项通过，存储层新增4项全部失败；记录在任务目录 `ninecli-replacement-20261021/metadata-red.log` 与 `cache-store-red.log`。补充边界时又复现了畸形发现响应冒充空列表、缓存保存非必需上游字段的问题，记录为 `metadata-boundaries-red.log`。

SDK生产工厂为三个reader供应新鲜认证会话；现在车辆元数据按业务UID与区域独立存文件，文件名使用二者的SHA256摘要（不是凭据或匿名化保证），不以token作为身份。SDK不读取/迁移无法确认归属的 `vehicle-cache.json` 或 `vehicles.json`，也不覆盖它们。状态、电池、月度、详情都先取得会话再加载相同账号/区域的元数据；缓存缺失时受控失败，须先刷新车辆。换token但账号/区域不变可继续读取；其他账号和区域不可借用缓存。

SDK每次车辆刷新均按既有通配模型依次发现ebike与motor，避免完整旧缓存遮住新车型/服务族；只有两服务都成功且列表有效时才提交结果。两服务均返回有效空数组时，返回空车辆成功结果，IPC保持connected；单服务失败或畸形数据不返回半份车辆，也不覆盖前次完整缓存。返回UI的完整车辆数据保持；SDK持久缓存仅保留 `wnumber`、`business_line`、`vehicle_type` 三项路由字段。

车辆每次响应及落盘前后检查取消；原子文件提交前检查取消，临时文件独立命名并清理。跨账号分文件使已开始、不可撤销的旧文件rename也无法覆盖新账号缓存。状态、电池、月度、详情响应后同样丢弃clear后的迟到结果。旧的未供应SDK会话的legacy迁移reader保持原缓存路径；未改变legacy默认、旧文件和认证生命周期。

本轮新增28项测试：存储层5项、SDK隔离链路22项、SDK→IPC空车辆1项。覆盖空账号及新reader恢复、A→B→A、区域变化、同账号换token、全体reader拒绝旧归属缓存、新服务族、发现失败、元数据白名单、迟到发现/业务响应和提交前取消清理。全量 `pnpm run check` 82文件/733测试、格式/lint/Node和renderer类型通过；SDK browser类型与SDK/main/preload/renderer构建通过。所有数据和目录均为合成隔离测试，未读取真实账号/会话、未启动或重启PID21819；真实空车辆、切账号及当前窗口加载新代码仍未验收。

## 已交付：opt-in SDK-only 成品链路（568eadf、1d59357）

先复现构建命令缺失及SDK诊断/界面错误描述：4项中3项失败、1项通过，记录为任务目录 `ninecli-replacement-20261021/sdk-package-red.log`。验包拒绝用例先于实现定义；初次运行因验包模块尚不存在而无法收集测试，不将其算作业务断言失败。新增测试覆盖模式拒绝、默认入口、SDK固定入口、资源隔离、污染包拒绝、无legacy准备步骤和Windows无shell命令构造。

`pnpm run package:sdk:mac:dir` 明确选择独立SDK入口；同类Windows命令为 `package:sdk:win:dir`，要求目标系统。SDK入口没有legacy导入或运行时切回分支；普通入口及现有dev/preview/package/release脚本仍保留原legacy默认和显式SDK运行时选择。Vite产物隔离于 `build/generated/sdk-only/out`，成品隔离于 `release/sdk-only`。独立builder配置不继承资源数组，`extraResources`/`extraFiles`为空，仅映射该SDK产物、生产依赖、package与第三方说明；不调用ninecli准备脚本。使用本机已安装的固定Electron分发，禁止发布并采用与现有本地Mac流程一致的ad-hoc签名/不公证配置，没有使用发布凭据。

本轮实际生成 `release/sdk-only/mac-arm64/韭号出行.app`（0.2.0，arm64）。验包检查实际ASAR的SDK标识、固定入口、所需依赖和恢复资源，拒绝ninecli二进制、会话/本地配置文件及主入口或SDK依赖中的legacy/子进程执行路径；同时检查外置资源、原有8项fuse策略、bundle ID/版本/架构与深度严格签名。ASAR为6656项，`bundledNinecli=false`，签名和fuse校验通过。构建日志明确使用本地Electron，没有legacy准备/下载步骤。

`qa-sdk-only-package.mjs` 在Node VM中运行实际成品main和preload，仅替换Electron原生边界；它不启动Electron、读取屏幕或连接调试器。解包依赖限定在规范化后的成品临时目录内，避免仓库依赖回落；测试中曾发现ESM解析条件及Mac `/var`/`/private/var`别名问题，均已修复并重验。强制legacy环境仍返回SDK诊断，未登录冷启动/受限桥接/权限拒绝通过，网络调用、子进程调用、禁止文件读取均为0；合成旧会话与缓存canary未读取。它证明离线启动与打包依赖边界，不等同于真实Electron渲染、地图、登录或恢复实测。

SDK诊断不再将外部二进制标为平台不支持，三个业务域固定反映实际SDK读取；安全页说明进程内凭据、无外部进程和无自动legacy回退。第三方清单纠正为默认legacy包仍分发ninecli、SDK-only不分发。全量 `pnpm run check` 86文件/753测试、格式/lint/Node与renderer类型通过；普通legacy构建、SDK-only构建/打包与SDK browser类型通过。Windows仅通过配置/命令静态检查，没有构建或运行Windows成品。

证据保留于任务目录：`default-build-green.log`、`sdk-package-green.log`（构建、原生验包与harness）、`sdk-harness-green.log`（加强依赖路径保护后的重验）、`sdk-windows-plan.json`。首次构建日志 `sdk-package-build.log` 保留最初harness失败，不能当最终通过记录。没有将成品安装到Applications、启动真实窗口、使用真实账号或改动PID21819；没有默认切换、删除旧依赖、推送或发布。

## 本轮交付：真实Electron隔离离线启动

系统会话接口 `CGSessionCopyCurrentDictionary` 未返回可用状态，不能据此证明已解锁；本轮没有重试此前受保护的AX操作，也没有通过截图、DOM提取或CDP绕过界面保护。改用本次新建临时进程内部的固定事件/布尔报告，不读取屏幕内容。它补齐真实Electron/Chromium执行证据，仍不替代视觉验收。

SDK-only入口增加明确 `NINEBOT_SDK_OFFLINE_SMOKE_ROOT` 的后台验收模式：要求指定前缀的新根目录、精确位于其下的user-data/config、固定marker、空配置和mock-keychain开关。缺省只返回禁用标记，不执行验收读取或修改普通启动。启用时在创建SDK和窗口前拒绝Node fetch及Chromium HTTP/WebSocket请求；preload收到renderer挂载事件后，仅通过现有runtime/auth只读IPC回传SDK身份、桥接往返、未登录和挂载四个布尔值。主进程只接收本地顶层页面的报告，记录窗口创建、加载错误和自身Electron进程类型，不记录文本、URL、账号或凭据。

`node scripts/qa-sdk-native-smoke.ts --evidence=/绝对路径/报告.json` 先验包，再生成全新临时目录，以真实Mac成品启动；使用mock-keychain和本地拒绝代理，不开放调试端口。当前一次实机运行PID63285：窗口创建、本地页面加载、React挂载、preload/IPC往返、SDK身份和未登录状态全部为true；Node网络尝试、Chromium请求、加载/preload失败均为0，没有renderer崩溃。Electron报告Browser/GPU/Tab/Utility；仅查询该PID的3个直接子进程，未见ninecli。随后只退出本次进程，退出码0，并清理本次临时目录。

证据：任务目录 `ninecli-replacement-20261021/sdk-native-smoke-result.json` 为真实Electron的非秘密布尔结果；`sdk-native-build.log` 是这版隔离成品的构建、ASAR/资源/签名/fuse校验及Node VM harness通过记录。两类结果分开：真实Electron运行不使用mock Electron；先前harness则替换Electron边界。此次原生进程使用空配置、没有认证或业务请求；不能据此把真实登录/恢复/自然刷新/地图网络验收标为通过。

新增5项隔离目录与报告字段回归；首次测试在模块尚未实现时未收集，不宣称5项业务断言失败。最终全量87文件/758测试、格式/lint/Node和renderer类型及SDK browser类型通过；SDK-only Mac成品构建和原生验包通过。PID21819、真实账号/旧会话和Keychain没有作为测试输入；未安装到Applications、替换用户现用版本、切默认或发布。Windows不在本轮范围。

## 本轮交付：profile受控复验与脱敏失败分类

沿用隔离数据切换到成品后，PID20450曾出现restore完成、fresh但首个whoami失败，业务尚未启动。旧日志没有保存失败类别，不能回溯推定为网络、HTTP、凭据或协议问题；无认证服务根路径HEAD可达也不等于profile请求成功。

本轮只增加诊断，不修改认证协议、签名、会话资料或重试策略。profile失败现在仅记录运行时/传输/HTTP/业务/协议/配置/会话/unknown枚举，以及受限HTTP状态或短业务码；不保存原异常文本、cause、请求、账号、令牌或响应。分类与落盘均白名单重建，诊断回调抛错也不改变产品错误结果，不追加重试。

在独立旁路输出 `release/sdk-only-profile-probe` 构建分类版，未覆盖当时正在运行的旧包。全新空配置的原生探针PID42608证明fetch、Web Crypto实际存在，相同portable Passport signer的合成profile签名/解析通过，网络尝试为0，随后退出。因此排除了“缺少这两项运行时能力”的猜测，没有采用未证实的crypto补丁。探针把合成profile也纳入完成条件，避免仅凭未登录启动误报认证路径可用。

确认现有脱敏资格仍fresh且当前时间早于允许刷新时间后，仅安全停止已核实的PID20450，使用同一user-data/sdk-session启动分类成品PID44959。正常启动只触发一次profile即成功，随后车辆、月度和详情各完成一次；月度/详情均有upstream-completed，非缓存命中，无profile-failure或refresh事件。未强制刷新、登录、退出或请求新凭据。首次失败未复现，结论是受控复验已恢复，原始原因仍未知，不把诊断改动声称为根因修复。

当前保留PID44959供用户查看，运行的是本轮初始分类成品（基线bb9c8b3，ASAR摘要记在独立验收状态中）；后续分类枚举细化只做源码回归，不为其再次重启成功实例。`acceptance-state.json`与`profile-recovery-result.json`（任务隔离目录）记录本次新PID的脱敏计数；`profile-native-probe.json`与`profile-probe-build.log`（任务ninecli-replacement-20261021目录）记录独立无账号探针。普通与SDK-only最终源码构建、SDK browser类型及全量88文件/768测试、格式/lint/Node/renderer类型通过。

本次真实证据覆盖profile→车辆发现→同账号元数据读取→月度/详情；没有记录真实页数，不推广为跨页所有边界或跨账号实测。新实例地图请求无独立统计且没有视觉访问，本轮未验证地图健康；自然刷新仍未验收。旧PID21819的历史通过结果不充作本轮证据。

## 阻碍移除运行依赖的下一步顺序

已完成项目所需SDK业务读取、分页、空车辆/账号隔离及SDK-only本地成品链路；默认legacy产品仍保留。剩余范围：

1. **SDK-only剩余真实业务与视觉验收**：真实Electron启动及PID44959的profile、车辆、月度和详情已通过；仍需视觉/地图、空车辆/切账号、跨页边界、SMS、自然刷新/刷新后业务读取。不得篡改expiry、强制认证或把无刷新事件当失败。离线harness和本轮无账号原生启动均不替代这些结果。
2. **Windows与正式分发环境**：在Windows x64完成原生构建、安装/启动与SDK桥接验收；Mac正式签名、公证和安装/更新属于后续分发流程，当前仅本地ad-hoc目录成品。
3. **默认迁移决定**：验收后另行批准默认入口/打包切换、旧依赖删除与发布；当前普通scripts、extraResources和旧验包/GUI QA仍服务legacy，不会被SDK-only opt-in修改或替代。

SDK-only命令已经绕开旧prepare/verify/qa链并提供独立验证。只有普通默认链仍依赖ninecli，不能把本轮opt-in成功表述成全产品已经默认移除旧依赖。

## 来源校验更正

不存在先前报告的macOS哈希冲突：原文件SHA256 `2d8aef91a74275528c995217fc7a56e5e2507d069acbd28f340e0aa573908f0a`匹配准备脚本；运行时对Mach-O签名归一化后SHA256 `70ba65c63a09373a6eab63cf96b80cd06fff2fd107dff63e884efafb9b31352c`匹配代码与验包脚本。两值自d701040分别用于不同范围。当前已知文件在两种文件校验范围均匹配，未执行它、下载替换包或修改校验值。任务目录 ninecli-replacement-20261021/distribution-baseline.json保留复算与历史索引；本地未发现wheel，未独立重新核验wheel METADATA。
