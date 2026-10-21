# 车辆业务只读增量研究（2026-10-21）

基线 `e1086e1`。此次继续研究车辆/行程业务，不重复国家目录，不增加诊断，不读取真实账号、缓存或凭据，不操作 PID 21819，不执行真实请求。结论：找到有价值的部件信息查询，但传输协议尚不充分；本轮交付静态研究，不新增猜测客户端。

## 现有能力与实际差集

| 方向           | 已有范围                                                                   | 当前研究结果                                                                   |
| -------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 车辆/状态/电池 | 自有共享列表、服务族、锁/点火/续航/充电、单/双电池及 BMS；SDK 与桌面均已有 | 不重复实现                                                                     |
| 行程           | 全月分页、单条详情、服务端月汇总/每日里程、跨月本地统计、回放及导出        | 仓库旧“20条”描述落后于代码；未找到证据充分的新只读搜索/时间范围接口            |
| 服务权益       | 已有 smart_service_surplus_days、过期状态                                  | 完整权益目录/套餐详情仍无已证实完整协议                                        |
| 部件信息       | 已有电池信息不等于完整部件信息；无按 PN 查询入口                           | 找到具体查询路径、字段、模型与真实调用来源；加密/服务配置仍不足，详见下文      |
| 固件查询       | 无独立固件版本查询客户端                                                   | 找到 checkFirmwareUpdate，但含 download 参数；不能认定无副作用或等同纯版本读取 |
| 故障/告警历史  | 现有设备监看仅比较当前状态，内存变化不是服务器历史                         | 本轮未恢复完整请求/响应闭环，不断言 APK 无此能力                               |

源码依据：`src/shared/contracts.ts`、`src/main/parsers.ts`、`packages/ninebot-client/src/telemetry-node.ts`、`travel-node.ts`、`candidate-session-core.ts`、`src/renderer/src/App.tsx`。既定 `PRODUCT.md` 的主要业务项已标完成，没有新的已定义只读实现任务可直接照单推进。公开 API 差集不等于官方 APK 的全量差集。

## 四段遗漏区域的恢复

复用同一 `classes-complete.dex`，SHA256 `db87f85c916921a5edd71d63d8c5f7c7059fde0be291b0959f41028fe0218bcc`。旧 map 扫描漏掉 class_data 位于 map_list 后的区域；本轮从 map 自引用项反推 base，逐项解析 class_data 到边界，保留原始文件与旧索引不变。

| base     | class_data 末尾（绝对、未含对齐） | 字符串 ID 直接匹配 / 前缀恢复 | 类定义 / class_data 项 |
| -------- | --------------------------------- | ----------------------------- | ---------------------- |
| 221748   | 10196419                          | 64359 / 996                   | 7297 / 6997            |
| 31502464 | 39645833                          | 61129 / 996                   | 6275 / 6082            |
| 58815624 | 63060604                          | 32809 / 996                   | 2668 / 2629            |
| 73886464 | 79129396                          | 41216 / 996                   | 3219 / 3175            |

四段前缀恢复均恰为 string ID 0–995；class_data 定义数、唯一偏移与 map 项计数相符，已引用 code 的边界检查通过，末尾 0–3 字节零对齐与下一区域一致。map 的 code_item 计数分别比已引用项多 3/2/3/10，未把这些未引用 code 算作已检查。先前失败的 7120 字节区域 base73879344 仍有 128/128 string_ids 不匹配，未移除断言强行恢复。

新索引使原先未覆盖的 `Lcn/ninebot/commonlibs/nbnet/CommonHttpClient;` 定义可读；这是普通 DEX 静态解析，不是 REA/Hopper 运行成功。新增可解析区域不等于整个 APK 或所有动态模块已恢复。APK 内 platform.zip 含 Hermes platform.bundle，但未从中取得新的车辆/行程接口闭环，未执行该 bundle。

## 选中的候选：按 PN 查询部件信息

用途是识别一个已知 PN 的部件信息，不是列举车辆的全部部件，也不包括绑定/解绑。

- region43170704 的 `MotorApiService.getPartInfoByPN` 25842：POST `/parts/index/get-info-by-pn`，FormUrlEncoded；POST 注解绝对偏移 `50245981`，泛型签名 `50245945`。
- 字段是 `wnumber:String`、`vehicle_type:int`、`pn:String`，返回 `CommonServerResponse<ThirdPartsBean>`。未发现字段改名注解。
- `MotorApiSource.getPartInfoByPN` 25971（`46212760`）检查 sn/pn 后只调用一次 service。上游 `ScanPartsQRCodeHWActivity$checkPartQrCode$1.invokeSuspend` 29315 从 DeviceBean 的 wnumber、vehicleType 与扫描所得 PN 取值，在 `46409300` 调用；没有默认 vehicle_type 的依据。
- 成功回调 29309（`46408852`）先处理查询结果；绑定状态检查是随后独立调用，查询方法体内未观察到隐含绑定请求。仅能据此作高置信只读分类，服务端状态记录未实测。
- 返回模型包含 pn/partType/partTypeName/partImgUrl/position/mac，也包含 wifiMac/wifiName/wifiPwd。后续如实现，应使用明确的非秘密信息模型，避免直接暴露整个上游对象；本轮只读取字段名，未取得任何真实值。

## 为什么尚不能提交客户端

1. 服务地址由 MotorApiSource 的 Companion（25899，`46209204`）按 vehicleType 查询 DynamicConfigManager 的 host 配置，再构造 ServerRegion；不能猜固定域名或固定车型。
2. MotorHttpClient 构造器调用 CommonHttpClient（`46216894`），未覆写 needEncrypt。新恢复定义中的 30971（`35324624`）固定返回 true。
3. CommonHttpClient 30957 将 BaseParametersInterceptor、BodyParametersProvider 与加/解密器连接。BaseParametersInterceptor 1453（`52243536`）的完整方法只检查 POST、body、表单媒体类型，不检查 URI；本部件查询符合条件，未发现路径加密豁免。
4. YiDunSecurityPolicy.encryptor 31650（`35367284`）返回 YiDunRequestEncrypt；rawEncryptor31658（`35367312`）经31654按实际配置 ver==4 选择 YiDunRiskEncrypt，否则选择 NeteaseDecrypt。配置构造默认 ver=3，但真实配置来自31651（`35367112`）的缓存，本轮未读缓存；默认值不能代替运行配置。
5. 新分支31636（`35365352`）/31635（`35365126`）调用 HTProtect.safeCommToServerByteV30/safeCommFromServer；旧分支8289（`60317978`）/8286（`60317878`）调用 NetSecKit 的 encryptStringToServer/decryptStringFromServer。实际 SDK 初始化、wire 兼容性、动态 host 与配置仍未知。路径判定31659仅控制附加 token，不构成加密豁免。

因此不能发送明文表单、直接套用 Passport SHA256，或宣称现有 ninecli 派生加密器与该 APK 链兼容。也不将只写 DTO/请求字段加合成测试包装成一个已完成业务增量。未执行/伪造安全 SDK，未绕过认证、加密访问控制或锁屏。

## 交付、验证与后续边界

派生索引：[APK_VEHICLE_READ_EVIDENCE.json](APK_VEHICLE_READ_EVIDENCE.json)。任务目录 `business-capabilities-20261021/` 保存新增 map 索引、结构校验结果、完整方法的脱敏解析与恢复脚本；原有 `rea-followup-20261020/vehicle-part-readonly-evidence.json` 保存候选注解与调用链。原 APK/DEX 未加入仓库。

本轮没有产品/SDK 源码改动或新的线上验收。验证是静态结构、方法边界、注解与现有源码差集核对；不把这些当作 API 实测或密码学兼容验证。REA MCP/JADX 的既有限制未通过安装工具绕开，未触发新的权限拒绝或待审批动作。

下一步应先用现有公开静态材料确认动态 host 选择、配置与安全 SDK 的受支持调用/兼容边界；若仍依赖真实缓存或初始化，先明确该依赖再决定最小验证范围，不读取旧登录数据补洞。固件 download 语义、故障历史闭环也仍待证实；在这些证据到位之前，不新增猜测的车辆客户端。legacy 哈希差异继续独立保留。
