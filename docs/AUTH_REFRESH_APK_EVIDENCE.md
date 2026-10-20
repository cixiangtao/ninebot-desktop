# 官方 APK 刷新字段差异与修复

2026-10-20，按用户明确要求使用本机 REA 技能继续认证兼容性逆向。已从官方 Android 包实际刷新方法恢复一项具体差异：**JSON 应为 access_token / refresh_token，旧 ninecli 与此前 SDK 却发送 accessToken / refreshToken**。当前修复改正字段并对实际 wire body 签名；后续用户报告v3密码认证CLI全链路通过。代理没有执行真实认证，SMS/真实GUI等仍未验收，不能宣布一期整体完成。

## 技能、工具和实际边界

技能准确名称 `reverse-engineer-anything`，主说明 version 42，随本机 `rea-agents 6.5.0` 提供：
`/Users/xbb/.nvm/versions/node/v24.18.0/lib/node_modules/rea-agents/skills/reverse-engineer-anything/SKILL.md`。已完整阅读主说明、Android、native/artifact 和连接恢复指南。它支持原生、APK、JavaScript 等目标，可用 CLI，不要求先重装或修复 MCP。

当前会话未暴露 REA MCP 工具；Codex 注册检查 aligned。doctor 发现现有 Hopper 路径，但实际 `rea function ninecli 0x10027e490 --provider hopper` 在 open_binary 的启动阶段失败：`Cannot launch Hopper! Connection is invalid.`。REA 返回 `cleanup_incomplete`，Hopper 文档及 `/tmp/rea-72MHo0` 的关闭未确认；记录的 launcher PID 已不存在，但不能据此宣称 GUI 文档清理完成。没有重复打开目标或重试旧 sandbox 拒绝。Android JADX 后端未配置，未安装新工具或改配置。

依技能的继续调查原则，转用现有 Python 标准库静态格式解析和系统 `/usr/bin/objdump`。这些产物是普通本地工具证据，不伪称成功的 REA Evidence ID。没有执行 APK、原版或 native 函数，没有读取账号秘密、真实认证、系统安全/证书设置修改。

## 固定官方来源和恢复方法

[九号官方下载页](https://app.ninebot.com/downloads/v5/cn.html) 指向小米官方分发，最终精确 [CDN APK](https://fga1.market.xiaomi.com/download/AppStore/06526052e73a240d09559655d54d3fd57b58a5bfa/cn.ninebot.ninebot.apk)。包内身份 `cn.ninebot.ninebot`，6.10.12 / versionCode 610124167。APK SHA256：`6ac8bfb50504a7bef741b74fe9c7f6399985f19bd9afecfddcc924cee7dc7f8c`。独立签名证书指纹未比对；这是已核验的制造商→官方商店分发链。

先前只读了 classes.dex 标准头指向的前219592字节，不能把它的阴性结果外推整个114690844字节文件。后续完整文件在偏移53384551命中 `/v3/user/refresh`。进一步发现尾部保留了多个标准 DEX map_list 自描述表，选中含刷新路径的业务区域：base=51233168，bytes=3255472，map absolute=54488420。

该区域前4096字节被改写，包含头和前996项 string_ids；其余表及业务方法仍可静态读取。按 string_data 的 Modified UTF-8/ULEB 顺序恢复索引，与全部29255项幸存 string_ids 精确逐项对应；受影响前缀的字符串顺序也通过排序核对。关键 token/device 字符串索引大于996，可直接由幸存 ID 验证。选区含2269类，不把18个候选 map 或此选区宣称为全包完整恢复。

完整 classes.dex SHA256：`db87f85c916921a5edd71d63d8c5f7c7059fde0be291b0959f41028fe0218bcc`。来源、偏移和字节摘要见 [结构化证据](AUTH_REFRESH_APK_EVIDENCE.json)。未修改或执行原包。

## 方法与调用链的直接观察

`Lcn/ninebot/lib/passport/account/PassportApiClient;->refreshAccessToken()`，method_id 1805，code_item relative 1038720，原始 classes.dex 指令起点52271904。顺序解码全部124个16位指令单元，未以任意字节碰巧像 opcode 来判调用：

| 指令单元   | 观察                                                                     |
| ---------- | ------------------------------------------------------------------------ |
| 5、7、11   | const-string access_token；getAccessToken；HashMap.put                   |
| 14、16、20 | const-string refresh_token；getRefreshToken；HashMap.put                 |
| 23、25、27 | device、ANDROID；HashMap.put                                             |
| 34、36     | /v3/user/refresh；generateHeaders(path, map)                             |
| 40、44     | createRequestBody(map)；PassportApiService.postCall(path, headers, body) |

`postCall` 的真实注解为 `retrofit2.http.POST` 和 `Content-Type: application/json`。`createRequestBody` method_id1729 使用 Gson.toJson(map)，随后 RequestBody.create；token字段直接进入JSON，没有转换成camel-case。

`generateHeaders` method_id1736 调用 `generateSignString` method_id1739；后者合并clientKey、毫秒timestamp、url、mParams及body map，再调用 SignUtil.sign。SignUtil 经TreeMap/String.compareTo排序，原始key=value用&拼接，UTF-8 SHA256转小写hex，没有观察到URL转义。刷新使用generateHeaders，不是另一个会加Authorization的generateAuthorizationHeaders。

独立 native库 `libnativesecrets.so` SHA256 `b29461112cf4754ab663752701007a2ab13d841aab5ffefd07ce091eb86ee33d` 的 Domestic JNI 0x15630、常量0xda40、mask0xdb8f，可通过静态字节和objdump指令推导出国内ClientKey，精确匹配现SDK。因此没有改ClientKey。

方法1805在构造请求前没有有效期/等待判断；这只说明该方法没有本地时机门槛，不证明服务端允许所有fresh token立即刷新。可选security interceptor的实际启用受调用者配置影响；本轮未证明全部反射/未恢复区域的配置。它不影响已经直接观察到的刷新body字段差异，也不支持凭类存在就盲加密请求。

## 修复与测试

代码提交 `9f9aa36`，仅本地提交，未推送。

- buildRefreshRequest 的 wire JSON 仅改为access_token、device、refresh_token；公共session/options继续用accessToken/refreshToken。
- signer接收实际新body，签名自动覆盖下划线字段；固定向量由独立Python hashlib按字面参数计算，实际loopback对端再用Node crypto核对线签名。
- 原版camel body/sign保留为历史负对照，不再将“复刻原版”当作官方正确合同。
- 诊断version=3，新增固定枚举tokenFieldNames=snake-case/camel-case/other；expectedFieldsOnly及材料比较按新字段。无凭据、签名值或目标地址进入报告。
- 原有缺材料本地拒绝、90002失败不替换会话、无自动重试及重定向拒绝继续保留。未改User-Agent、设备、静态版本元数据、成功码或降级为密码重登录。

本轮完整检查：72文件/535测试通过；浏览器目标类型、SDK/Electron main/preload/renderer构建、CLI `--help`通过。测试为合成与本机loopback，不证明线上refresh成功。

## 当前验收与剩余边界

v2报告直接HTTP200/90002排除重定向假设。修复后，主对话于2026-10-20转交用户自行运行的v3报告：password login、profile、restore、refresh、restore-refreshed、profile-refreshed、logout全部passed，overall passed。由此记录该账号密码路径CLI验收通过；不是代理再次登录，也不扩展为所有账号、SMS或GUI已通过。无需为同一成功路径重复验收。

当前剩余范围是SMS及人机挑战、真实桌面GUI连接状态、领域读取和默认运行时切换等；见 [一期认证验收](AUTH_PHASE1.md)。本轮凭据问题仅做方案评估，不创建密码存储或持久访问。

本机完整解析脚本、方法逐指令JSON、signing交叉核对和失败诊断保存在任务目录 `rea-followup-20261020/`；APK/DEX/第三方反编译全文不提交仓库。Hopper辅助资源关闭仍是不确定结果，未把这项工具故障说成所有逆向分析不可行。
