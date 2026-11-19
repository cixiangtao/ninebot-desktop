# Business 离线证据边界（2026-10-20）

本阶段只新增文档和合成数据测试；没有修改生产认证、解密、会话策略或接入独立认证结果模型。目标是区分 ninecli 静态行为与当前 TS 的可执行行为，不能把两者的一致样本当作原版全路径回放。

## 来源与执行边界

研究对象为仓库 `scripts/prepare-ninecli-runtime.mjs` 固定的 ninecli 0.1.7 ARM64 产物，SHA-256：

```text
2d8aef91a74275528c995217fc7a56e5e2507d069acbd28f340e0aa573908f0a
```

本次未下载、安装或执行该产物。仓库固定哈希说明产物身份，不能代替发布者签名或隔离执行保障。此前仅限制网络的历史回放脚本不能保障真实配置/会话不可读写，因此没有重用它启动原版。

新的沙箱预检只尝试执行系统 `/usr/bin/true`，使用禁止网络、限制文件读写、禁止 IOKit 访问和额外程序执行的 profile。系统返回 exit 71：`sandbox-exec: sandbox_apply: Operation not permitted`。原版没有启动；本阶段停止动态回放，没有扩大权限、重试沙箱、附加调试器或修改二进制。

## 原版已证明的静态分支

以下地址来自固定二进制的完整函数导出和手工控制流还原；动态执行证明仍缺失。

| 边界                  | 条件和行为                                                                                                                                                                   | 地址                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Business.Login 返回码 | JSON 数字解码为 Go float64，只有数值 0 或 1 可继续；字符串 `"0"`/`"1"`、缺失、null、布尔、数组、对象及其他数值拒绝                                                           | `0x10027c4ec..0x10027c594`                                                          |
| Business.Login 身份   | data 必须为非 nil map，uid 必须是非空字符串；未 trim，所以仅空白字符串可继续                                                                                                 | 同上                                                                                |
| DecryptResponse 外层  | r 必须为字符串；标准 Base64 → 四段请求 keyData 派生 AES-CBC → JSON map → 字符串 data → 有限反转义 → 删除 SP/LF/CR/TAB → Base64。每步失败直接错误，无明文 JSON 或裸字符串回退 | `[0x100278a30,0x100278e90)`                                                         |
| 新登录落盘            | finishLogin 先保存 Passport material，再执行 Business；Business 失败警告后返回成功，留下未完成 material；成功取得 uid 后第二次保存。保存失败是错误                           | `0x100322550`；保存 `0x1003225a0`、Business `0x100322684`、第二次保存 `0x1003226c4` |
| 既有会话补 UID        | ensureBusinessUID 先检查刷新；已有 UID 可直接返回，缺 UID 则 Business 登录并保存，此处 Business 失败向上传错                                                                 | `0x1003253a0`                                                                       |
| 加载                  | LoadTokens 解析 JSON，没有相同的完整会话验证；因此加载成功不能推出业务可用                                                                                                   | 上阶段 Config/Tokens 证据                                                           |

数值 0 的真实上游语义仍未知；本阶段没有据此选定生产成功码，也没有真实服务端故障因果证明。上述所有失败条件描述的是本地分支，不是完整上游业务错误码字典。

## 底层 helper 与 TS 差异

静态提取覆盖 DecryptResponse、DeriveKey、ComputeCheckcode、unescapeJSONString、writeJSONValue、AESDecrypt、PKCS7Unpad、base64.init 共 8 个完整函数、1,324 个逐 4 字节指令行、242 个直接分支（含 94 个 BL）。验证脚本核对地址覆盖、原始分支编码及目标；这不等于全指令语义证明，也未解析所有间接调用。

| helper         | 固定原版静态事实                                                                                                                  | 当前 TS                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 响应信封       | DecryptResponse 读取字符串 r，不读取 v/s；r 指针 `0x100365dcb`、data 指针 `0x1003660dc` 已从 ADRP/ADD 编码和原始字节验证          | 信封还要求 number v / string s                                                        |
| 解密后结构     | 必须 JSON map 且 data 为 string；无裸字符串回退                                                                                   | 也接受 quoted/raw Base64 fallback                                                     |
| 第二层反转义   | 仅 quote、backslash、n、r、t；不 trim、不处理 u/slash/b/f                                                                         | trim、额外转义与引号解析；接受范围更宽                                                |
| DeriveKey      | 四段 rolling/mix/布尔网络，输出 16 字节小端；逐项静态对应                                                                         | 表达式可对应，未做新增原版运行差分                                                    |
| AES / padding  | 零 IV AES-CBC，严格 PKCS7 长度和逐字节检查                                                                                        | 正常协议路径对应；非法 key/密文的错误检查顺序有差异                                   |
| Base64         | 标准 `+/` alphabet，`=` padding；没有先做回编码检查                                                                               | 要求 canonical 正则及回编码；原版标准库边缘接受集未全恢复                             |
| body checkcode | MD5 后转为 32 位大写十六进制                                                                                                      | 对应；不是 lowercase wrapper checksum                                                 |
| writeJSONValue | 专用 string 仅转义 LF/TAB/CR/quote/backslash，其他 rune 直写；float64 用 f/-1/64；通用 Encoder 关闭 HTML escape、忽略 Encode 错误 | JSON.stringify 对控制字符和大浮点可能产生不同字节；没有证明这些边缘值导致真实登录失败 |

原版 Business.Login 本身只检查 code/data/uid；TS 解析还拒绝非字符串 desc、非数字 time_cost。独立 `referenceCurrentTsBusinessResult` 只模拟返回判定，不包含前置 decoder/schema；不能据它推定整个 TS 路径接受。

## 可复现 TS 验证

```sh
pnpm exec vitest run packages/ninebot-client/src/business-offline-reference.test.ts
pnpm run check
```

新增 40 个测试直接调用当前 TS Business 初始化器，经内存 transport 解开临时测试 RSA 请求、校验 wrapper MD5、检查 18 个最终字段、派生响应密钥并返回合成 AES 响应。无 socket、真实账号/凭据、设备访问、文件 store 或原版执行。固定字段、判断结果可复现；测试 RSA 和请求随机量每次新建，不保存私钥。

- 返回码矩阵覆盖数字 0/1、字符串 0/1、缺失/null/bool/array/object、2/-1/1.5/90000/字符串90000/空串/01。
- 身份矩阵覆盖空白/空串/缺失/null/bool/number/array/object UID，以及 null/array/string data。
- 实际 TS 接受 1/`"1"` + 非空白字符串 UID，拒绝 0；静态原版接受 0/1 + 非空字符串 UID，拒绝 `"1"`。额外验证 desc/time_cost 的 TS schema 拒绝。
- 验证 gzip、quoted/raw 回退、v/s 缺失拒绝；这些是 TS 结果，原版侧只标静态预测。
- 凭据缺失或空白时请求计数为 0；Business 失败后内存 store 为空或保持旧会话，成功后才替换为完整会话。Passport 已返回由合成 client 注入，没有测试 Passport 服务端认证。

本次验证：定向 40/40；`pnpm run check` 通过格式、lint、Node/desktop 类型检查与 69 个文件 / 459 个测试；`git diff --check` 通过。仅新增文档及测试，没有需要重新验证的生产构建改动。

## 本机证据与未完成项

本机调查包：`/Users/xbb/Documents/Codex/2026-10-20/task/business-offline-20261020/`。其中 `STATIC-HELPERS.md` 包含精确伪代码、错误返回和指令位置；`static-verification.json` 保存逐函数哈希和校验结果；`extract-static.py` 仅 LLDB target create/disassemble；`verify-static.py` 校验字节；`sandbox-preflight.json` 保存预检拒绝。上阶段状态转换证据在同级 `auth-evidence-20261020/`。

**原版 Business 全路径成功回放未完成，当前阻塞为沙箱初始化被系统拒绝。** 后续首先需要经认可的可用隔离执行环境；还须建立本次随机请求 keyData 与合成响应的匹配方法。静态范围已排除普通明文响应回退，未证明不存在其他合法注入边界。不得用 TS 测试通过代替原版动态证明。
