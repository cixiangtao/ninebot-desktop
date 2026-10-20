# 独立认证结果合同

此切片提供无副作用的结果观察、显式接受策略和离线行为参考，尚未接入生产认证。它不执行HTTP、登录、刷新、发短信或持久化；`accepted`只表示调用者选定的响应/材料合同通过，不表示已提交会话、车辆就绪或真实认证验收通过。

## 模块边界

- `@jiuhao/ninebot-client/auth-result`：`observeAuthResult(operation, decodedJson)`与`assessAuthResult(observation, explicitPolicy)`及其类型。独立子路径可用于无Node依赖的宿主。
- `@jiuhao/ninebot-client/auth-result-reference`：固定原版与当前TS的参考模型，仅用于对照；不从SDK根入口重导出，也不作为生产默认策略。
- 当前 `passport-login-client`、`business-session-node`、会话管理器及桌面IPC接线均不使用新模块，原有行为保持原样。

observer分别保存`code`与`resultCode`的缺失、null及JSON类型；数值只保留绝对值不大于999999999的安全整数，字符串只保留空串或至多9位的有符号十进制形式。其他有限数字/字符串保留类型、值置null。任意上游文本、描述、令牌、UUID/UID和额外字段不进入观察结果；数据字段只报告missing/wrong-type/empty/blank/present。这里的受限码仅为诊断，不承担完整响应存储。

## 所有产品选择都显式提供

`AuthResultPolicy`不提供默认实例。调用者必须指定operation、两个字段各自的check/ignore策略、成功/挑战码、missing/null/未知码决策、冲突决策、是否允许没有显式成功码、描述形状校验，以及需要的data字段和空白规则。

评估顺序固定为：envelope/所选描述形状 → 活跃码字段类型 → 成功与拒绝/挑战冲突 → 明确拒绝 → 显式挑战码 → 未决码 → 缺成功证据 → data形状/材料要求。成功和拒绝冲突可选择reject或ambiguous。未知不等于成功；挑战必须来自调用者显式映射，不从错误码2或任意含captcha字样的描述自动推导。成功码与挑战码重叠、码值超出诊断边界、operation不匹配会抛固定错误，不附原始数据。

第一阶段仅建立合同，不选择不确定的Business成功集合。测试将数字0/1和字符串"1"保留为独立候选策略分支，也演示所有码仍为ambiguous的状态。没有决定是否兼容原版Passport-only半成品；本模块没有session或store接口，也不会把Passport的`uid`提升为业务身份。`uid`字段只在调用者指定的operation及材料要求中有意义。

## 参考模型与证据

固定目标是ninecli 0.1.7 ARM64，SHA-256：
`2d8aef91a74275528c995217fc7a56e5e2507d069acbd28f340e0aa573908f0a`。

原版Passport gate静态锚点：密码`0x10031db5c`，发码`0x10031e340`，消费`0x10031e710`，刷新`0x10027e5e0`。它检查顶层code，却漏检数值resultCode；这项缺陷只在reference中保留。`continue`不意味着data/token、业务阶段或完整登录成功。

`auth-result-reference.test.ts`内10个合成输入及各自REA Evidence ID来自已保存的原版发码回放；这些记录**没有在本轮重跑**。本轮运行的是新参考模型测试。测试另用注入transport和假凭据调用当前TS密码client，验证相同输入下的当前gate行为；这不是短信实现或真实请求。原版profile controller未在该批材料中还原，原版profile reference返回unavailable；当前短信provider尚未实现请求，当前TS短信reference也返回unavailable。

| 判据输入                          | 固定原版gate | 当前TS密码gate |
| --------------------------------- | ------------ | -------------- |
| resultCode数值90202或2            | continue     | reject         |
| resultCode字符串90202或2          | reject       | reject         |
| code数值1 + resultCode字符串90000 | reject       | continue       |
| resultCode字符串0                 | reject       | continue       |

Business参考锚点`0x10027c4ec..0x10027c594`：原版只接受数字0/1和非空string UID，不trim；当前TS接受数字1或字符串"1"且要求trim非空UID。相关表驱动测试是**静态预测的执行模型测试**，未执行原版Business成功全路径，也不建立真实成功码的权威含义。参考函数只检查业务响应，不证明输入凭据、加解密或持久化已完成。

## 验证与后续边界

离线测试覆盖十个已存回放输入、当前TS注入对照、双字段冲突、类型/缺失差异、诊断脱敏、数据完整度、显式挑战和未决Business策略。浏览器类型检查也覆盖两个新模块。仓库check、SDK/桌面build结果以本次实际执行日志为准，历史343个测试通过不当成本轮结果。

下一切片是五个Passport操作的请求/签名字节合同，再接两阶段和生命周期组件。仍待补Business成功全路径受控回放、低层序列化/加解密证据及真实首登/刷新验收；这些不阻塞本纯函数切片，也不因本切片通过而被视为完成。接入旧配置前才需要明确Passport-only恢复策略；完整替代短信路径还需正常人机挑战交互范围。
