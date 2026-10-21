# 以桌面实际能力替代 ninecli（2026-10-21）

用户已明确：目标是 ninebot-desktop 所需能力和移除 legacy 运行依赖，API 可以重设计；不要求兼容 ninecli 的命令、flags、默认参数、JSON 文案或退出码。不为未使用的控制指令或全部官方 App 能力补实现。APK 只在核对本项目所需协议时使用；部件查询扩展暂停，不是替代前提。

当前普通入口仍默认 legacy，`NINEBOT_AUTH_SOURCE=sdk` 明确 opt-in。此轮不切默认、不删除旧版本、不推送、不操作 PID21819 或真实会话。SDK 的应用合同是 `NinebotAppClient` 与 renderer IPC，而不是子进程输出。

## 可核验的必要能力矩阵

“已有”指代码实现存在；自动合成通过、历史真实证据与待真实验收分别列出，不相互替代。历史真实结果来自既有验收记录/用户反馈，本轮未重新请求或观察实例。

| 必需流程                 | SDK / 桌面实现与自身合同                                                                              | 自动证据                                                                                   | 真实证据与剩余缺口                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 密码登录与连接状态       | auth-node 的 Passport→Business 两阶段，只接受完整会话；失败不替换旧会话；SDK app client→IPC           | auth-node、auth-result、sdk-desktop-runtime 测试                                           | 用户报告密码验收七阶段通过；独立 SDK 桌面登录曾通过，不推广所有账号/车型                                        |
| 恢复、刷新、退出         | SDK store、并发刷新/替换竞态、显式退出；桌面 legacySession=ignore，不依赖运行 ninecli 或读取旧 tokens | auth、store、auth-node、桌面合成生命周期及恢复→业务→刷新回归                               | SDK恢复/profile已有实测；真实自然刷新和当前窗口的完整退出/重登仍待验收。切换时需明确保留旧文件、SDK重新登录策略 |
| 短信与挑战               | SDK发码/消费及Business初始化；挑战受控报错，不虚报成功；旧表单晚到响应忽略                            | passport-sms、sms-login-flow、离线 Electron QA                                             | 真实 SMS 未验收；内嵌挑战未实现，保留受控边界，不绕过验证                                                       |
| 车辆（自有/共享）        | vehicle-source及SDK车辆客户端；发现ebike/motor；输出自有VehicleSummary/opaque ID                      | vehicle-source、vehicle-node、SDK缓存隔离及IPC空车辆回归                                   | 历史单账号车辆通过；空车辆、跨账号/区域与新增服务族现已离线通过，尚待真实账号验收                               |
| 状态、电池、位置         | telemetry SDK、BMS/锁/点火/续航/充电解析，按需授权位置；不包含控制操作                                | telemetry-node、分区快照、位置桥接与本轮真实reader→IPC合成测试                             | 历史五类读取及位置桥接记录不等于所有车型通过；错误契约与本轮缓存隔离尚未加载进当前实例                          |
| 月度行程、详情、分页     | travel SDK及candidate-session全月分页，桌面RideMonth/RideDetail；本地统计/回放/导出复用结果           | travel-node、travel-pagination新增44项完整性回归、parsers/统计/IPC                         | 月度/详情历史实测通过；分页完整性与本轮账号缓存隔离离线通过，尚无真实跨页服务验收                               |
| 错误与会话失效           | 自有NinebotClientError→IPC；明确HTTP401与既有auth错误通知重新登录；临时错误允许分区降级               | **已完成7a5740a** sdk-app-client及sdk-read-error-integration；覆盖403/未知业务码不误判auth | 合成回归通过；不等于本轮真实401或服务故障验收                                                                   |
| 缓存、刷新、取消         | IPC TTL、并发合并、手动绕缓存、失效清理及迟到结果保护；无需旧进程                                     | session-read-cache、sdk-read-diagnostics、sdk-vehicle-cache-isolation及存储取消测试        | 账号/区域持久元数据隔离与迟到结果保护离线通过；缓存命中不证明新网络读取或自然刷新                               |
| 跨平台运行、离线构建     | Node/TS SDK，无Python/Go子进程需求；同一应用合同可用于macOS/Windows                                   | SDK/Electron构建、browser类型检查、现有Windows静态/包脚本                                  | Windows原生安装/启动仍需Windows主机；browser类型检查不代表桌面已支持全部浏览器                                  |
| 成品分发、启动与安全说明 | **仍有legacy依赖**，不能因SDK reader存在就称已移除                                                    | 当前成品QA主要覆盖legacy；本轮未打新包                                                     | 需统一生产入口、无ninecli包断言、SDK冷启动/恢复冒烟及运行诊断；切换/删除留给后续批准范围                        |

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

## 本轮交付：无车辆冷启动与账号元数据隔离（906dcb8、030c827）

先新增合成数据失败复现：桌面读取链路16项中15项失败、1项通过，存储层新增4项全部失败；记录在任务目录 `ninecli-replacement-20261021/metadata-red.log` 与 `cache-store-red.log`。补充边界时又复现了畸形发现响应冒充空列表、缓存保存非必需上游字段的问题，记录为 `metadata-boundaries-red.log`。

SDK生产工厂为三个reader供应新鲜认证会话；现在车辆元数据按业务UID与区域独立存文件，文件名使用二者的SHA256摘要（不是凭据或匿名化保证），不以token作为身份。SDK不读取/迁移无法确认归属的 `vehicle-cache.json` 或 `vehicles.json`，也不覆盖它们。状态、电池、月度、详情都先取得会话再加载相同账号/区域的元数据；缓存缺失时受控失败，须先刷新车辆。换token但账号/区域不变可继续读取；其他账号和区域不可借用缓存。

SDK每次车辆刷新均按既有通配模型依次发现ebike与motor，避免完整旧缓存遮住新车型/服务族；只有两服务都成功且列表有效时才提交结果。两服务均返回有效空数组时，返回空车辆成功结果，IPC保持connected；单服务失败或畸形数据不返回半份车辆，也不覆盖前次完整缓存。返回UI的完整车辆数据保持；SDK持久缓存仅保留 `wnumber`、`business_line`、`vehicle_type` 三项路由字段。

车辆每次响应及落盘前后检查取消；原子文件提交前检查取消，临时文件独立命名并清理。跨账号分文件使已开始、不可撤销的旧文件rename也无法覆盖新账号缓存。状态、电池、月度、详情响应后同样丢弃clear后的迟到结果。旧的未供应SDK会话的legacy迁移reader保持原缓存路径；未改变legacy默认、旧文件和认证生命周期。

本轮新增28项测试：存储层5项、SDK隔离链路22项、SDK→IPC空车辆1项。覆盖空账号及新reader恢复、A→B→A、区域变化、同账号换token、全体reader拒绝旧归属缓存、新服务族、发现失败、元数据白名单、迟到发现/业务响应和提交前取消清理。全量 `pnpm run check` 82文件/733测试、格式/lint/Node和renderer类型通过；SDK browser类型与SDK/main/preload/renderer构建通过。所有数据和目录均为合成隔离测试，未读取真实账号/会话、未启动或重启PID21819；真实空车辆、切账号及当前窗口加载新代码仍未验收。

## 阻碍移除运行依赖的下一步顺序

已完成SDK分页完整性、空车辆与账号元数据隔离离线增量，下一步顺序：

1. **SDK成品链路**：使唯一生产入口和打包/验包/冷启动QA共同不依赖旧二进制；同步诊断界面和第三方清单。当前还未实施，不能只删除extraResources。
2. **必要真实验收与切换决定**：在允许的独立流程补空车辆/切账号、跨页月度、SMS、自然刷新及Windows/SDK成品；不篡改expiry或把无刷新事件当失败。普通默认切换、删除旧依赖和发布不在本轮执行范围。

分发依赖准确位置：package.json的dev/preview、package/release脚本仍prepare-ninecli-runtime，extraResources仍含二进制；index.ts有默认legacy/hybrid分支；verify-package.mjs、verify-package-windows.mjs要求文件/哈希；qa-packaged.mjs只接受0.1.7/verified；SDK诊断binary=unsupported与SecuritySheet的旧二进制说明也需调整。THIRD_PARTY_NOTICES的“不再分发”描述与当前配置不一致，最终成品清理时必须纠正。

## 来源校验更正

不存在先前报告的macOS哈希冲突：原文件SHA256 `2d8aef91a74275528c995217fc7a56e5e2507d069acbd28f340e0aa573908f0a`匹配准备脚本；运行时对Mach-O签名归一化后SHA256 `70ba65c63a09373a6eab63cf96b80cd06fff2fd107dff63e884efafb9b31352c`匹配代码与验包脚本。两值自d701040分别用于不同范围。当前已知文件在两种文件校验范围均匹配，未执行它、下载替换包或修改校验值。任务目录 ninecli-replacement-20261021/distribution-baseline.json保留复算与历史索引；本地未发现wheel，未独立重新核验wheel METADATA。
