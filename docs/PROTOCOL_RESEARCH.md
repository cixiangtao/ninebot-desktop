# 九号协议研究计划

目标是把韭号出行当前依赖的只读能力逐步实现为 Node.js/TypeScript SDK，并让 ninecli 在迁移期只承担行为对照（oracle），而不是直接猜测尚未确认的加密、签名和令牌刷新机制。

## 当前结构

```text
packages/ninebot-client
├── 九号服务域配置
├── 只读能力范围
├── 协议记录契约
└── 本地反向代理记录器

scripts/protocol-recorder.ts
└── 启动五个仅监听 127.0.0.1 的记录入口
```

`pnpm build:sdk` 会把 `@jiuhao/ninebot-client` 编译为可供 Node.js 导入的 ESM JavaScript 和 `.d.ts` 类型声明。当前包保持 `private`，避免协议尚未稳定时被误发布。

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

只有明确执行下面的命令才会保存请求体和响应体的 Base64 原文：

```bash
pnpm protocol:record -- --include-bodies
```

原始 Body 可能包含账号、令牌、车辆、位置和轨迹，应始终视为账号敏感数据。任何进入公开测试夹具的样本都必须先单独归一化和脱敏，不能直接复制私有捕获文件。

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
