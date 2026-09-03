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

会话编排另外拆在 `candidate-session-core` 子路径，公共字段与响应类型位于 `candidate-contracts`。这两个文件只使用 DOM/ECMAScript 可用的类型和运行时 API，不导入 Node 加密模块；core 只接收平台提供的车辆、telemetry 和 travel 客户端，统一负责字段组装、request-id、取消信号和会话清理。因此 Web 或 React Native 可以先复用生命周期，再单独实现符合平台能力的加密 provider。`crypto-web` 子路径已补上 Base64、MD5、Web Crypto AES、浏览器兼容的 RSA PKCS#1 v1.5、key mixer 和随机材料原语，`crypto-web-codec` 进一步组装请求外壳与响应解密链，`transport-web` 提供对应的 Fetch/超时/取消边界，但尚未组成完整的 Web/mobile service client。Node/Electron 继续通过 `candidate-session` 使用内置的 Node crypto 实现，两条路径共享同一份调用契约；`pnpm check` 会额外运行 DOM-only 类型检查。

认证生命周期边界现在位于 `auth` 子路径：`NinebotAuthSessionManager` 负责登录结果替换、异步会话存储、过期前刷新、退出清理和防御性副本，密码只由调用方在一次登录尝试中持有，不会写入 manager。真实九号登录、签名和令牌刷新仍由待验证的 runtime-specific auth provider 注入；这一步不把尚未确认的协议字段伪装成已完成的登录实现。

当前已落地的核心边界：

- `buildWhoamiRequest` 固化已验证的 `POST /v5/user`、空 JSON Body 和请求 Header 形状。
- `NinebotTransport` 让 Node、浏览器、React Native 和测试替身可以共用请求模型；`createFetchNinebotTransport` 是默认 Fetch 实现。
- `decodeJsonEnvelope` 在核心层解析 `data`、`resultCode`、`resultDesc` 包装；Node/Electron 可从 `response-node` 子路径使用 gzip 解码器，移动端可注入自己的 decoder。
- 签名通过 `NinebotRequestSigner` 注入，当前不假定 canonical string、密钥或字段顺序。
- `createNinebotClient().whoami()` 已将请求、transport 和响应解码串起来；非 2xx 响应只抛出状态错误，不暴露响应正文。
- `parseNinebotEncryptedRequest` 和 `parseNinebotEncryptedResponse` 只校验已观察到的 `d/h/k/p/t` 与 `v/s/r` 外壳，不对密文做未经证实的解释。
- `buildVehicleListRequest` 已能生成 `ebike`/`motor` 的 `POST /vehicle/binding/my-vehicle` 外壳请求；调用方负责提供密文 envelope 和动态 Header，后续 codec 再接入真正的加密实现。
- `NinebotVehicleCodec`、`buildVehicleListRequestWithCodec` 和 `decodeVehicleListResponseWithCodec` 已提供加密实现的注入点；请求明文和响应密文都只在内存中交给 codec，HTTP 层不解释其内容。
- codec 合同支持可选的 `responseContext`：请求编码器可返回本次请求专属上下文，高层车辆客户端会原样传给对应响应解码器，从而支持临时 keyData 而不依赖全局队列；旧的只返回 envelope 的 codec 仍兼容。
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

已有私有 capture 可用下面的只读报告命令做形状复核。它会自动处理 gzip，只输出字段长度、Base64 合法性和 AES 块对齐，不输出原始 Body 或 Header：

```bash
pnpm protocol:report -- vehicles-raw
```

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

本次只保存元数据和 Body 摘要，没有保存账号响应正文。响应包装已经由私有样本确认；签名输入仍需要更多受控样本和二进制实现对照。

当前阶段已取得私有原始样本用于本地分析：响应为 gzip 编码，解压后是上述 JSON 包装；`timestamp` 为 13 位十进制毫秒时间戳，`sign` 为 64 字符十六进制值。样本不会进入仓库，签名算法仍待多组受控样本和二进制实现对照后确认。

## 密码登录请求形状（2026-09-03）

使用假的用户名和密码、仅转发到本机 stub 的私有记录器，ninecli 发出：

- HTTP 方法与路径为 `POST /v6/user/login`。
- 请求体字段和序列化顺序为 `areaCode`、`device`、`password`、`username`；默认设备值为 `ANDROID`。
- Header 延续 `clientid`、`app_version`、系统信息、13 位毫秒 `timestamp` 和 64 字符十六进制 `sign`。
- ninecli 读取响应 `data.access_token`、`data.refresh_token`、`data.business_uid`，并把 `accessTokenValidity` 一并保存到本地 token 文件。

该采集只证明 ninecli 的请求/响应形状和本地解析边界，不证明 stub 返回值能通过九号服务端认证；TypeScript 已提供 `buildPasswordLoginRequest` 与 token 字段解析器。

2026-09-03 对随应用分发的 arm64 ninecli 0.1.7 做了本地静态分析和动态断点：Go 符号恢复得到 `internal/crypto.PassportCanonicalString`、`PassportSign` 和 `EncodeOrderedJSON` 三个函数边界；`PassportSign` 调用标准库 `crypto/sha256.Sum256`，再把 32 字节摘要编码成 64 位小写十六进制字符串。动态返回值确认 canonical 是按字节序排序的原始查询字符串，字段包括 `app_version`、请求体原始字段、固定 `clientKey=e177176a-3b3e-1513-e26e-d1123034cb66`、系统字段、13 位毫秒 `timestamp` 和 `url`，以 `&` 连接且不做 URL 编码。Node 已实现 `buildPassportCanonicalString` 与 `createNinebotPassportSigner`，并用私有捕获的登录样本复算出相同的 `sign`；该实现仍保留显式 signer 覆盖点以支持版本差分。

同日通过 ninecli 的本地 `serve` 暴露的 `/auth/refresh` 流程触发 refresh 请求，并将 Passport 上游指向本机 stub，确认：

- HTTP 方法与路径为 `POST /v3/user/refresh`。
- 请求体字段和序列化顺序为 `accessToken`、`device`、`refreshToken`，设备值为 `ANDROID`。
- 响应仍使用 `resultCode`、`resultDesc`、`data` 包装；refresh 返回可以省略 `business_uid`，调用方应沿用当前会话的业务 UID。

该请求同样携带 13 位毫秒 `timestamp` 与 64 字符十六进制 `sign`。TypeScript 已提供 `buildRefreshRequest`、`parsePassportRefreshSession` 和 Passport client 的 `refresh()`；Node Passport client 默认使用已验证的 SHA-256 signer，同时保留显式覆盖点。

## 车辆列表首条观察

2026-09-02 使用同一会话运行 `vehicles` 时，记录到 `motor` 服务请求 `POST /vehicle/binding/my-vehicle`。请求包含 `uid`、设备与平台信息等 Header，请求体为 2400 字节的封装数据；本次代理没有拿到可用的上游响应状态，因此尚不能确认响应包装或字段契约。该请求体和 Header 值均未进入仓库。下一步会在私有原始模式下重复采集，并先判断封装/加密边界，再决定是复用通用解码器还是单独建模。

重复采集已确认请求体 JSON 外壳包含 `d`、`h`、`k`、`p`、`t` 五个字符串字段；gzip 解压后的响应外壳包含数值字段 `v` 和字符串字段 `s`、`r`。`d` 与 `r` 仍视为不透明密文，原始值只留在本机私有捕获目录。

两条同条件私有样本的差分显示：请求 `p`、`t` 和响应 `v` 保持不变，而请求 `d`、`h`、`k` 以及响应 `s`、`r` 每次都变化；`k` 与 `s` 均为 172 字符，`h` 为 32 字符。这个现象支持“每次请求带临时密钥或校验材料”的假设，但还不能推出具体算法、密钥或字段拼接顺序，因此 SDK 仍只解析外壳。

## ninecli 加密函数定位（2026-09-02）

对随应用分发的 macOS ninecli 二进制读取 Go `pclntab` 后，已经能恢复出 `gitea.com/ninebot/cli/internal/crypto` 的函数边界。这个结果只用于本地行为对照，不会把账号数据、密文或私钥写入仓库。

- `GenKReq` 生成 16 字节字符材料；`GenNonce` 生成 16 字节随机值并转为 32 个小写十六进制字符。
- `GenKeyData` 调用 `randHex(11)`、`randHex(11)`、`randHex(10)`，先生成长度为 11/11/10 的 ASCII hex 原始材料；`BuildWrapper` 将前三段按十六进制文本写入 wrapper，因此 JSON 字段长度为 22/22/20，再写入长度为 8 的 `keyDataFour`。
- `BuildWrapper` 的字段顺序可从常量确认：`data`、四个 `keyData` 字段、`platform`、`timeStamp`；`data` 在进入包装前经过标准 Base64 编码和 JSON 字符串转义。
- `EncryptRequest` 的参数布局已通过断点确认：包装明文、16 字节 `kReq`、四段 keyData、`platform` 和 `timeStamp`。它直接使用 `kReq` 做 AES-CBC，再对同一个 `kReq` 调用 RSA PKCS#1 v1.5 形成 `k`；随后对包装明文调用 `md5.Sum` 并转成 32 位小写十六进制，这与请求外壳中的 `h` 长度相符。AES 输出再经过 Base64，形成 `d`。
- `DeriveKey` 对四段原始输入（断点观测长度为 11/11/10/8）分别执行“左旋 8 位后与下一个字节异或”的滚动字，然后做固定的位运算混合并输出 16 字节。它出现在响应解密路径；Node 候选实现位于 `crypto-node` 子路径，尚未接入默认车辆 codec。
- `BuildWrapper` 和 `EncryptRequest` 的动态断点都显示 `timeStamp` 使用 Unix epoch 秒（例如 `0x6a97f656` 对应十位数量级），不是用户界面常见的毫秒时间戳。Node 候选的 `NinebotCandidateRequestMaterial.timeStamp` 因此按秒建模。
- `DecryptResponse` 的动态入口参数包含四段原始 keyData，长度仍为 11/11/10/8；后续对外层 `r` 字段执行 Base64 解码时，输入长度与捕获响应的 `r` 长度相符（本次样本为 3008 和 364）。AES 解密后的内容还会经过 `unescapeJSONString`，随后在另一个调用点再次执行 Base64 解码（对应输入长度 2208 和 228）。这说明响应至少存在“外层 Base64 → AES → JSON 反转义 → 内层 Base64”的候选链路。
- 一次新的私有 oracle 回放中，直接取 `BuildWrapper` 返回的 1602 字节明文和同次调用的 16 字节 `kReq`，Node 侧 AES-CBC 输出 1616 字节的 `d` 与 motor 捕获逐字节一致，MD5 生成的 `h` 也一致。该回放确认了 wrapper 内容、`AndroidB64` 结果、AES 直接使用 `kReq` 及 MD5 输入边界；原始材料到 JSON 字段的 22/22/20 字符转换也由此得到交叉验证。
- 当前动态证据只证明成功路径使用了 `r`，尚未证明外层 `s` 在该路径中的用途；因此 Node 实现将两者继续视为外壳字段，并把二次解码放在显式候选函数中。
- RSA 调用点明确使用 `crypto/rsa.EncryptPKCS1v15`，`k`/`s` 的 128 字节解码长度与 RSA-1024 输出一致；具体输入材料和公钥用途仍需用同一会话做端到端回放确认。

因此当前迁移边界保持不变：Node 层可以安全复用 AES、Base64、MD5、RSA-PKCS#1 v1.5 和四输入 key mixer 候选，但只有在候选请求经 ninecli oracle 与服务端成功验证后，才允许把它提升为车辆列表的默认 codec。

### 2026-09-02 wrapper 字段形状更正

后续私有 oracle 直接解析 `BuildWrapper` 返回的 JSON：前三段 keyData 字段长度为 11/11/10，`keyDataFour` 为 8；`data` 是 76 字符换行且末尾带 LF 的 Android 风格 Base64（JSON 中以转义换行保存）。因此上文关于 22/22/20 字段长度和标准 Base64 的描述已被这次直接导出结果取代，Node 候选实现以本节为准。

同一批私有响应样本进一步确认：`DecryptResponse` 的外层 `r` 解密结果是包含 `data` 和 `timeStamp` 的 JSON 对象，二次 Base64 输入来自该对象的 `data` 字段，而不是整个 JSON 文本。Node 候选解码器现在先提取并反转义 `data`，再执行严格 Base64 解码；真实 motor 响应已成功还原为 JSON 业务数据。

当前已新增 `@jiuhao/ninebot-client/crypto-codec` Node 子路径：它按上述顺序生成包装 JSON，输出候选 `d`、`h`、`k`、`p`、`t`，并提供两个边界：只解密外层 `r` 的原始函数，以及继续执行反转义和内层 Base64 解码的显式候选函数。该模块保留显式 `material` 参数，方便用固定 fixture 做差分测试；它不会自动接管 `createNinebotVehicleClient`，也不会在没有 oracle 成功证据时生成真实请求。

Node 专用 `@jiuhao/ninebot-client/vehicle-node` 子路径现在还提供车辆列表明文候选构造器：按 ninecli 观察到的固定字段顺序生成 JSON，并对不含 `checkcode` 的 JSON 计算大写 MD5。它只负责明文和校验字段，不持有令牌、不自动加密或发送请求。

同一路径的 `buildVehicleListEncryptedRequestCandidate` 会一次性生成明文、临时 `kReq`、四段 keyData 和加密外壳，并返回本次请求专属的 keyData 上下文；调用方可将该上下文绑定到对应响应 decoder，避免并发请求互相覆盖。

`decodeVehicleListResponseCandidate` 和 `parseVehicleListResponseCandidate` 负责把解密后的业务 JSON 校验为 `{ code, data, desc, time_cost, extra }` 候选包装，再由上层把 `data` 交给现有车辆领域解析器；它们不会把原始密文或账号字段写入磁盘。

Node 子路径另外提供 `decodeVehicleListResponseCandidateWithCodec`，将通用的响应 envelope/codec 边界与上述业务包装解析串起，调用方可以直接拿到候选元数据和 `data`，无需先处理中间字节。该适配只改变本地解析便利性；当前 Electron 的车辆数据默认已走 SDK，认证仍保留 ninecli 兼容入口。

`createNinebotVehicleCandidateCodec` 已实现带上下文的 `NinebotVehicleCodec` 合同：每次编码返回独立 keyData 上下文，响应解码只使用传回的对应上下文；该 codec 已由 Electron 默认车辆 reader 使用，认证和显式 `NINEBOT_SOURCE=ninecli` 才会触及旧运行时。

`createNinebotVehicleCandidateClient` 在此合同之上补齐车辆列表的 Node 调用链：接收 `transport`、`VehicleListPlaintextFields` 和服务类型，内部完成明文校验、候选 envelope 构造、响应上下文传递及业务包装解析。它适合接入本地 recorder 或测试 transport，尚未绑定 Electron 默认数据源。

从 ninecli 0.1.7 二进制静态数据中还识别出唯一一段 1024-bit RSA PKCS#1 公钥（指数 65537）。该公钥以 `@jiuhao/ninebot-client/rsa-node` 的 `ninebotCandidateRsaPublicKeyPem` 导出，供候选请求使用或显式覆盖；它不是私钥，也不代表请求已经完成服务端验证。公钥材料服务于 Node SDK 候选路径；Electron 默认数据 reader 已使用该路径，认证仍待 Passport 签名协议闭环。

车辆列表候选构造器和候选 codec 在未提供 `rsaPublicKey` 时会使用上述固定公钥；调用方仍可传入覆盖值做版本或环境差分。这个默认值只减少回放样板代码，Passport 登录/刷新签名仍未完成服务端 parity。

候选请求在加密前会校验公钥必须是 1024-bit、指数 65537；这与捕获到的 128 字节 `k`/`s` 外壳一致，错误的 2048-bit 或损坏材料会在本地直接失败。

2026-09-03 使用本机已有会话做了一次不保存 Body 原文的 `vehicles` 回放：`ebike` 的 `POST /vehicle/binding/my-vehicle` 返回 HTTP 200，响应外壳 `v=101`、`s` 解码 128 字节、`r` 解码 2256 字节；ninecli 输出 1 条车辆记录。请求 `d` 解码 1616 字节、`k` 解码 128 字节，和候选请求的 AES/RSA 外壳长度一致。该回放只保留在 `.ninebot-private`，未把账号、车辆或密文写入仓库。

同日通过 lldb 在 `EncryptRequest` 入口捕获了 3 组脱敏前的本机临时明文（只留在 `/tmp`）：`nonce` 均为 32 位十六进制，但字母大小写可为全大写或混合大小写；按固定 15 个字段重建的 JSON 计算出的 32 位大写 MD5 均与 `checkcode` 一致。因此 Node 候选只约束十六进制字符集，不再错误限定 nonce 必须小写。

### 2026-09-03 候选请求完成服务端验证

使用同一台机器上的现有会话，对候选 Node 请求使用新生成的 nonce、当前 Unix epoch 秒 `serviceTime`、已提取的 RSA-1024 公钥，以及从 ninecli 观察到的非敏感 Header 映射后，经本地记录器发送到真实 `steeldust.ninebot.com`。`motor` 车辆列表请求返回 HTTP 200，候选解密链成功得到业务包装：`code=1`、`data` 为数组（本账号该服务族为空）。这证明候选的 AES-CBC、Android Base64、MD5、RSA PKCS#1 v1.5、响应 keyData 绑定和 envelope 外壳已通过一次真实服务端校验；本次只保留归一化结果，未将账号、令牌、密文或车辆数据写入仓库。

同批 oracle 样本确认两种车辆服务都使用 `p="101"`、`t="0"`。Node 候选现在将这两个值设为默认值，并提供 `buildVehicleListCandidateHeaders`：根据 `motor`/`ebike` 映射 `business-type`，从请求明文映射 `client-ver`、`device-id`、平台版本、地区、语言、用户标识和服务时间，同时补齐 `cache-control`、`debug`、`request-id` 与 `user-agent` 等已观察 Header。调用方仍可显式覆盖 Header 或 RSA 公钥，以便后续版本差分。

这次验证只提升 Node 候选路径的可信度；Electron 默认数据源已切换为 SDK，旧 ninecli 仅在显式配置或认证兼容入口中保留。登录、令牌刷新和短信人机验证仍未完成纯 SDK 迁移。

### 2026-09-03 travel 月度请求形状

通过同一记录器对 `travel --month 202608` 取得一组私有样本，确认请求进入 `travel` 服务的 `POST /app-api/travel/v6/travel-list2`。请求和响应仍使用与车辆列表相同的 `d/h/k/p/t`、`v/s/r` 加密外壳，样本中 `p="101"`、`t="0"`，请求 `d` 解码后为 AES 块对齐数据，响应 `r` 解码后为 gzip 包装的外层响应。

在 `EncryptRequest` 入口捕获到的月度明文固定字段顺序为：通用设备/会话字段，随后是 `wnumber`、`rnVersion`、`vehicle_type`、`month`、`page`、`current_version`、`serviceTime`、`nonce` 和 `checkcode`。去掉 `checkcode` 后按该顺序重建 JSON，并计算大写 MD5，可与 oracle 明文中的 `checkcode` 一致。Node 子路径新增 `travel-node`，提供月度明文校验、候选加密 envelope、请求上下文和月度响应对象解析；原始 Body 未写入仓库。

随后使用新 nonce/服务时间、完整 Header 映射和 `travel-node` 候选实现回放 `travel-list2`，真实服务端返回 HTTP 200；Node 成功解密并解析出业务 `code=1`、`month="202608"`、31 项日明细和 20 条行程记录。该验证提升了月度 travel 候选链的可信度；Electron 默认 travel reader 已接入 SDK，更多月份、车型和账号 parity 仍是持续验证项。

### 2026-09-03 travel 详情请求形状

继续对同一月份的一条行程运行 `travel --detail`，确认请求进入 `POST /app-api/travel/v6/travel-info`。详情明文沿用月度请求的通用设备/会话字段、`wnumber`、`rnVersion`、`vehicle_type`、`current_version`、`serviceTime`、`nonce` 和大写 MD5 `checkcode`，将 `month`/`page` 替换为 `travel_id`。Node `travel-node` 现已提供详情明文构造器、候选 envelope、详情响应解包器和 `trail` 类型校验。

使用新 nonce/服务时间和同一 Header 映射做了一次真实详情回放，服务端返回 HTTP 200；Node 成功解析 `code=1`，并得到字符串形式的 `trail` 和 `speed` 字段。现有 `parseRideMonth` / `parseRideDetail` 已能直接消费候选 codec 的业务 wrapper，保持渲染层数据模型不变。原始轨迹正文没有写入仓库，Electron 默认详情 reader 已走 SDK；多条行程和车型交叉样本仍需补齐。

### 2026-09-03 status 与 battery 请求形状

通过本机已有会话对实时状态命令做只读对照，确认 `status` 进入 `POST /vehicle/vehicle/desktop-component`，`battery` 进入 `POST /v6/vehicle/battery-info`。两条请求继续使用 `d/h/k/p/t` 与 `v/s/r` 加密外壳，服务端均返回 HTTP 200；解密后的业务层统一为 `{ code, data, desc, time_cost, extra }`，其中 status 的 `data` 为数组，battery 的 `data` 为对象。

两条明文都沿用通用设备/会话字段、`serviceTime`、`nonce` 和大写 MD5 `checkcode`。status 额外携带 `sn_str`，battery 额外携带 `wnumber`；请求 Header 与车辆列表保持同一组设备、平台、语言、用户、服务时间和 `business-type` 映射。Node 子路径新增 `telemetry-node`，提供两条明文构造器、候选加密 envelope、统一响应 wrapper 解析和 transport-backed client，便于后续用同一账号做字段级对照。

本次 status/battery 请求已用真实服务端完成 HTTP 200 校验，原始账号、令牌、设备标识、密文和响应正文均未写入仓库。该证据只提升候选链的可信度；Electron 默认 telemetry reader 已走 SDK，登录、令牌刷新和短信人机验证仍未完成纯 SDK 迁移。

应用层解析器现在也接受 telemetry 候选客户端返回的业务 wrapper：status 的数组数据取首个车辆对象，battery 的对象数据直接进入现有快照模型，位置读取复用同一解包边界。这样切换数据源不会改变 renderer 合同；IPC 仅在显式旧源配置下使用 ninecli。

`telemetry-node` 还提供 `parseVehicleStatusResponseCandidate` 与 `parseVehicleBatteryResponseCandidate` 两个类型入口：前者校验并返回 status 车辆记录数组，后者校验并返回 battery 诊断对象；两者都保留固件新增字段。当前已知字段覆盖实时电量、充电、锁定/点火、续航、主电源、BMS 电压/温度/循环次数等，具体数值仍交由应用层按单位和范围校验。

当服务端返回 HTTP 2xx 但业务 `data` 为空或类型不符时，两个类型入口会抛出 `NinebotTelemetryBusinessError`。错误只携带 `code`、`desc` 和 `dataKind`，不保留原始响应正文，调用方可以据此记录 `190003` 等业务失败并继续走 ninecli 回退路径。

为减少接入方手工拼接请求字段，`buildVehicleStatusFields` / `buildVehicleBatteryFields` 接收共享会话元数据和车辆序列号，自动补齐 Unix 毫秒级 `serviceTime` 与随机 nonce；测试或回放可显式传入两者。注意，这里的明文 `serviceTime` 与加密外壳的 `timeStamp` 是两个字段：前者经 oracle 确认为毫秒，后者仍按已验证的 Unix 秒建模。会话元数据只停留在调用方内存中，SDK 不负责从 ninecli 私有配置文件读取令牌。

客户端方法参数也按能力拆成 `VehicleStatusCandidateOptions` 与 `VehicleBatteryCandidateOptions`，避免调用方把两种不同的明文字段误混在一起；两者仍共享 `service` 和可选 Header 覆盖。

为支持迁移期的字段级对照，`@jiuhao/ninebot-client` 新增 `compareNinebotPayloads`。它只在内存比较 ninecli 与 Node 结果，报告路径、类型、长度和差异原因，不返回任何字段值；数组和嵌套对象达到比较上限时会标记 `truncated`，不会把不完整比较误报为一致。

仓库同时提供 `pnpm protocol:parity -- --rounds=3`，从 `NINEBOT_CONFIG_DIR` 读取本机已有 ninecli 会话，连续运行 oracle 与 Node telemetry/travel 候选，并只输出 parity 元数据。脚本支持 `--vehicle-index`、`--all-vehicles`、`--service` 和 `--month`；其中 `--all-vehicles` 会按缓存顺序逐车执行完整套件，适合新账号或多车型会话。脚本不会打印车辆序列号、令牌、坐标、Header 值或响应正文；只要任一轮请求失败或出现差异，进程就以退出码 1 结束。

parity 脚本现在直接调用 SDK 的 `createNinebotCandidateSessionClient`，而不是在脚本内重复拼装 telemetry、车辆列表和 travel 客户端；因此真实账号门禁同时覆盖公共 SDK 的会话字段、车型映射和五类请求入口。

Electron 默认使用 Node telemetry 候选；设置 `NINEBOT_TELEMETRY_SOURCE=ninecli` 才会强制走内置 oracle。候选读取本地 SDK 会话，失败时默认直接报告错误；构造器的 `fallbackToLegacy` 仅供迁移 parity 测试显式开启。

telemetry 候选源现通过 `createNinebotCandidateSessionClient` 生成 status/battery 请求，主进程不再重复拼装候选字段；三类 Electron 候选开关同时开启时，真实只读 QA 仍验证账号、设备、历史行程和导出链路正常。

候选源在主进程内按请求重新读取会话文件，因此登录、刷新和退出后不会复用旧令牌；默认不会因候选或会话读取异常而回退 ninecli，避免 SDK 默认路径暗中依赖旧运行时。需要对照时由调用方显式开启 `fallbackToLegacy`。

首次使用本机配置自动拼装 status/battery 候选请求的回放显示：真实服务端返回 HTTP 200，但业务 wrapper 为 `code=190003`、`data=null`、通讯异常描述。由此确认 HTTP 层成功不等于业务协议已验证；类型化解析器会拒绝这类空数据，Electron 继续保留 ninecli 默认路径，后续需要用 oracle 明文/Header 做字段级修正。

随后对同一账号运行了一次私有 oracle 采集：status 与 battery 的请求 `d` 均为解码后 1616 字节，响应 `r` 分别为 1296 和 880 字节，均保持 AES 块对齐。将 oracle 的 Header 名称和值指纹与 Node 生成结果在内存中对照后，18 个非敏感、非随机 Header 全部一致；差异只剩每次调用都会重新生成的 `request-id`。因此当前剩余不确定性已收敛到 telemetry 的业务调用上下文或服务端字段语义，不能再通过修改通用加密外壳解决。

继续回到 `EncryptRequest` 入口对照后发现，telemetry 明文的 `serviceTime` 使用 13 位 Unix 毫秒，而车辆列表和加密外壳的 `timeStamp` 仍使用已验证的 Unix 秒。Node 默认值已按能力拆开修正为毫秒；使用同一账号连续运行 3 轮 status/battery，并将 Node 数据与 ninecli 明文结果在内存中 parity，3 轮均为 `statusEqual=true`、`batteryEqual=true`，分别比较 25 和 19 个节点且未截断。该结果只证明当前账号、车辆和运行时版本下的只读 telemetry 候选链，Electron 默认仍保留 ninecli，待多车辆、多车型样本后再评估切换。

为继续推进 travel 迁移，主进程新增了独立的 `TravelReader` 边界；默认调用 `travel-node` 的月度/详情客户端，设置 `NINEBOT_TRAVEL_SOURCE=ninecli` 才强制走 oracle。候选源按请求重新读取本地会话，失败时默认直接报告；只有显式开启 `fallbackToLegacy` 才允许对照回退。travel 的 `serviceTime` 与请求 Header 的 `service-time` 均使用 Unix 毫秒，当前 ninecli 0.1.7 的 `rn-ver` 为 `743`。由于 travel 明文需要 `vehicle_type`，候选源优先读取 SDK 自己的 `vehicle-cache.json`，仅在显式 legacy fallback 时读取旧缓存或调用 oracle，不猜测模型值。

travel 候选源现通过 `createNinebotCandidateSessionClient` 生成月度和详情请求，主进程只负责从本地会话与车辆元数据解析调用参数；月度、详情默认各自失败即报错，legacy 回退边界必须显式开启。

`@jiuhao/ninebot-client` 根入口现导出 `travel-node` 的构造器、解析器、transport client 和类型，调用方可以在 Node、Electron 主进程或测试 transport 中复用同一套候选合同。该导出不代表登录、令牌刷新或移动端能力已迁移，也不改变候选请求必须经过多车型 parity 的门槛。

SDK 另提供 `createNinebotCandidateSessionClient` 和 `createNinebotFetchCandidateSessionClient` 作为只读聚合入口：调用方只需提供共享会话字段、车型编码和可注入 transport（或直接使用默认 fetch transport），即可访问车辆列表、status、battery、月度和详情候选。fetch 工厂会把局部 origin 覆盖与已验证默认地址合并，避免只改一个服务时意外丢失其它服务路由。该封装在内存中生成每次请求的 nonce、request-id 与服务时间，默认使用已验证的 `rnVersion=743` 和 `current_version=610063322`；协议回放和测试可以注入时钟及三个随机值工厂，显式传入的 Header 仍优先。调用方退出登录时可调用 `clear()`，之后的请求会在发送前失败。不执行登录、不读写令牌文件、不暴露控制能力，凭据生命周期仍由上层负责。

车辆列表现在也有独立的 `VehicleReader`；默认按服务族顺序发送 Node 候选列表请求，设置 `NINEBOT_VEHICLE_SOURCE=ninecli` 才强制走 oracle。候选返回非数组或请求失败时默认直接报错；显式 legacy fallback 才会回退。成功的候选元数据会写入 SDK 自己的 `vehicle-cache.json`，不改写旧 ninecli 缓存。

车辆列表候选源现同样通过 `createNinebotCandidateSessionClient` 发起请求；缓存完整时直接使用 SDK 本地服务族和模型码，缓存缺少模型码时只有显式 legacy fallback 才临时向 oracle 补齐。同一服务族存在多个模型码时会逐个请求并按车辆 SN 在内存中去重，三类 Electron 候选域因此共享同一个 SDK 会话入口。

会话生命周期也已收口：密码登录、短信登录成功以及退出成功都会清理车辆序列号映射、行程映射和三类读取缓存，并在切换账号时重置本地行程编号。登录失败不会清理仍在使用的会话；候选数据源本身按请求重新读取会话文件，因此不会在模块级别保留令牌或车辆数据。

修正模型码来源和毫秒级 `serviceTime` 后，使用本机现有会话做了独立 Node 直连验证：`travel-list2` 返回 `code=1`、请求月份、31 项日明细和 20 条行程；选取其中一条行程调用 `travel-info` 返回 `code=1`，`trail` 为字符串且包含速度字段。该验证没有经过 Electron 的 ninecli 回退路径，也没有保存响应正文，说明当前账号、车辆和 ninecli 0.1.7 下的 travel 月度/详情候选链已经完成单车型真实服务端校验；多车型和多版本 parity 仍是切换默认源前的门槛。

随后运行 `pnpm protocol:parity -- --rounds=3 --month=202608`，三轮车辆列表、status、battery、travel 月度和 travel 详情均 `equal=true` 且未截断；每轮分别比较 41、25、19、300 和 26 个节点，进程退出码为 0。该门禁只输出结构元数据，不保存或展示响应值；目前证据覆盖本机一台电自和一个月份，仍需其他车辆服务族与月份的连续样本。

为扩大月份覆盖，又在同一会话对 `202607` 运行两轮、对 `202606` 运行一轮；两个月份的五类对照均 `equal=true` 且未截断，车辆列表节点数为 41，月度节点数分别为 300/299，详情均为 26。当前账号仍只有一台电自，motor 服务族尚无可用车辆，不能用电自序列号代替 motor 做 parity。
