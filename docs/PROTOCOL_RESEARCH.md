# 九号协议研究计划

目标是把韭号出行当前依赖的只读能力逐步实现为 Node.js/TypeScript SDK，并让 ninecli 在迁移期只承担行为对照（oracle），而不是直接猜测尚未确认的加密、签名和令牌刷新机制。

## 当前结构

```text
packages/ninebot-client
├── 九号服务域配置
├── 只读能力范围
├── 协议记录契约
├── whoami 请求边界与传输抽象
└── 本地反向代理记录器

scripts/protocol-recorder.ts
└── 启动五个仅监听 127.0.0.1 的记录入口
```

`pnpm build:sdk` 会把 `@jiuhao/ninebot-client` 编译为可供 Node.js 导入的 ESM JavaScript 和 `.d.ts` 类型声明。当前包保持 `private`，避免协议尚未稳定时被误发布。

当前已落地的核心边界：

- `buildWhoamiRequest` 固化已验证的 `POST /v5/user`、空 JSON Body 和请求 Header 形状。
- `NinebotTransport` 让 Node、浏览器、React Native 和测试替身可以共用请求模型；`createFetchNinebotTransport` 是默认 Fetch 实现。
- `decodeJsonEnvelope` 在核心层解析 `data`、`resultCode`、`resultDesc` 包装；Node/Electron 可从 `response-node` 子路径使用 gzip 解码器，移动端可注入自己的 decoder。
- 签名通过 `NinebotRequestSigner` 注入，当前不假定 canonical string、密钥或字段顺序。
- `createNinebotClient().whoami()` 已将请求、transport 和响应解码串起来；非 2xx 响应只抛出状态错误，不暴露响应正文。
- `parseNinebotEncryptedRequest` 和 `parseNinebotEncryptedResponse` 只校验已观察到的 `d/h/k/p/t` 与 `v/s/r` 外壳，不对密文做未经证实的解释。
- `buildVehicleListRequest` 已能生成 `ebike`/`motor` 的 `POST /vehicle/binding/my-vehicle` 外壳请求；调用方负责提供密文 envelope 和动态 Header，后续 codec 再接入真正的加密实现。
- `NinebotVehicleCodec`、`buildVehicleListRequestWithCodec` 和 `decodeVehicleListResponseWithCodec` 已提供加密实现的注入点；请求明文和响应密文都只在内存中交给 codec，HTTP 层不解释其内容。
- `createNinebotVehicleClient().list()` 已串起 codec、transport、HTTP 状态检查和响应体 decoder；Node/Electron 可注入 `response-node` 的 gzip body decoder，其他平台可使用自己的实现。
- Node 专用 `crypto-node` 子路径已提供严格 Base64、AES-CBC/PKCS7 解密和 RSA-PKCS#1 v1.5 公钥加密原语；这些原语仅用于候选 codec 验证，尚未绑定 Ninebot 的字段派生规则。

首批只研究以下只读能力：

- `whoami`
- `vehicles`
- `status`
- `battery`
- `travel --month`
- `travel --detail`

鸣笛、开座桶、启动和熄火不进入 SDK 的初始范围。

## 启动记录器

```bash
pnpm protocol:record
```

命令会打印 `--passport-base`、`--biz-host`、`--ebike-host`、`--motor-host` 和 `--travel-host` 参数。保持记录器运行，在另一个终端把这些参数附加到内置 ninecli，再执行一个只读命令。

默认记录内容包括：

- 服务族、HTTP 方法和请求路径
- 脱敏后的请求与响应 Header
- 请求与响应体字节数
- 请求与响应体 SHA-256
- HTTP 状态码

所有结果写入 `.ninebot-private/protocol-captures/<session>`，不会进入 Git。认证、Cookie、令牌、设备标识、用户标识、UUID 和 IMEI 类 Header 无条件脱敏，但保留长度和哈希以便比较请求是否发生变化。

只有明确执行下面的命令才会保存请求体和响应体的 Base64 原文；如果要比较签名输出，还要额外显式打开签名 Header：

```bash
pnpm protocol:record -- --include-bodies --include-signing-headers
```

签名 Header 模式只保留 `clientid`、`sign` 和 `timestamp`，仍然会继续隐藏 `authorization`、Cookie 与其他令牌。原始 Body 可能包含账号、令牌、车辆、位置和轨迹，应始终视为账号敏感数据。任何进入公开测试夹具的样本都必须先单独归一化和脱敏，不能直接复制私有捕获文件。

## 迁移顺序

1. 使用已有令牌研究 `whoami`，确定最小认证请求与通用响应包装。
2. 研究 `vehicles`，确认业务登录、车辆类型与自有/共享关系。
3. 研究 `travel --month` 和 `travel --detail`，建立轨迹、速度、能耗的数据契约。
4. 研究 `status` 和 `battery`，补齐车型分流与实时状态。
5. 最后研究登录、令牌刷新和风控错误；短信人机验证不做绕过。

每完成一项能力，都使用同一账号与同一查询条件同时运行 ninecli 和 TypeScript SDK，对归一化结果做字段级比较。只有连续样本一致后，Electron 才切换该能力；未迁移能力继续使用当前内置运行时。

## 已确认的第一条基线

2026-08-31 已使用现有本地会话通过记录器成功执行一次 `whoami`，确认 Host 覆盖和反向代理链路真实可用：

- 请求进入 `passport` 服务族。
- HTTP 方法与路径为 `POST /v5/user`。
- 请求体长度为 2 字节，摘要与 `{}` 一致。
- 请求包含 `authorization`、`clientid`、`sign`、`timestamp` 以及应用和系统版本类 Header；记录器不保存前三类认证值，只保留长度和摘要。
- 上游返回 HTTP 200，ninecli 能透过本地代理正常解析响应。

本次只保存元数据和 Body 摘要，没有保存账号响应正文。下一步需要在私有 Body 捕获模式下取得一组 `whoami` 样本，确定响应包装和签名输入，再开始实现 TypeScript 请求生成器。

当前阶段已取得私有原始样本用于本地分析：响应为 gzip 编码，解压后是上述 JSON 包装；`timestamp` 为 13 位十进制毫秒时间戳，`sign` 为 64 字符十六进制值。样本不会进入仓库，签名算法仍待多组受控样本和二进制实现对照后确认。

## 车辆列表首条观察

2026-09-02 使用同一会话运行 `vehicles` 时，记录到 `motor` 服务请求 `POST /vehicle/binding/my-vehicle`。请求包含 `uid`、设备与平台信息等 Header，请求体为 2400 字节的封装数据；本次代理没有拿到可用的上游响应状态，因此尚不能确认响应包装或字段契约。该请求体和 Header 值均未进入仓库。下一步会在私有原始模式下重复采集，并先判断封装/加密边界，再决定是复用通用解码器还是单独建模。

重复采集已确认请求体 JSON 外壳包含 `d`、`h`、`k`、`p`、`t` 五个字符串字段；gzip 解压后的响应外壳包含数值字段 `v` 和字符串字段 `s`、`r`。`d` 与 `r` 仍视为不透明密文，原始值只留在本机私有捕获目录。

两条同条件私有样本的差分显示：请求 `p`、`t` 和响应 `v` 保持不变，而请求 `d`、`h`、`k` 以及响应 `s`、`r` 每次都变化；`k` 与 `s` 均为 172 字符，`h` 为 32 字符。这个现象支持“每次请求带临时密钥或校验材料”的假设，但还不能推出具体算法、密钥或字段拼接顺序，因此 SDK 仍只解析外壳。

## ninecli 加密函数定位（2026-09-02）

对随应用分发的 macOS ninecli 二进制读取 Go `pclntab` 后，已经能恢复出 `gitea.com/ninebot/cli/internal/crypto` 的函数边界。这个结果只用于本地行为对照，不会把账号数据、密文或私钥写入仓库。

- `GenKReq` 生成 16 字节字符材料；`GenNonce` 生成 16 字节随机值并转为 32 个小写十六进制字符。
- `GenKeyData` 调用 `randHex(11)`、`randHex(11)`、`randHex(10)`，并调用一次长度为 8 的字符集随机函数，随后由 `BuildWrapper` 按 `keyDataOne`、`keyDataTwo`、`keyDataThree`、`keyDataFour` 写入 JSON。
- `BuildWrapper` 的字段顺序可从常量确认：`data`、四个 `keyData` 字段、`platform`、`timeStamp`；`data` 在进入包装前经过标准 Base64 编码和 JSON 字符串转义。
- `EncryptRequest` 先构造包装明文，再调用 AES-CBC；随后对包装明文调用 `md5.Sum` 并转成 32 位小写十六进制，这与请求外壳中的 `h` 长度相符。AES 输出再经过 Base64，形成 `d` 的候选来源。
- `DeriveKey` 对四段输入分别执行“左旋 8 位后与下一个字节异或”的滚动字，然后做固定的位运算混合并输出 16 字节。Node 候选实现位于 `crypto-node` 子路径，尚未接入默认车辆 codec。
- RSA 调用点明确使用 `crypto/rsa.EncryptPKCS1v15`，`k`/`s` 的 128 字节解码长度与 RSA-1024 输出一致；具体输入材料和公钥用途仍需用同一会话做端到端回放确认。

因此当前迁移边界保持不变：Node 层可以安全复用 AES、Base64、MD5、RSA-PKCS#1 v1.5 和四输入 key mixer 候选，但只有在候选请求经 ninecli oracle 与服务端成功验证后，才允许把它提升为车辆列表的默认 codec。

当前已新增 `@jiuhao/ninebot-client/crypto-codec` Node 子路径：它按上述顺序生成包装 JSON，输出候选 `d`、`h`、`k`、`p`、`t`，并能使用同一组 keyData 解密响应 `r`。该模块保留显式 `material` 参数，方便用固定 fixture 做差分测试；它不会自动接管 `createNinebotVehicleClient`，也不会在没有 oracle 成功证据时生成真实请求。
