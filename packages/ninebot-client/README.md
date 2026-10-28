# @jiuhao/ninebot-client

九号只读协议 SDK。桌面端、CLI、浏览器及未来移动端共用协议规则、两阶段登录、会话生命周期和完整月份分页；网络、加密、凭据存储由宿主提供。SDK 不提供车辆控制，也不需要自建中转服务器。

当前版本为私有开发包 `0.0.0`，尚未发布到 npm，不是九号官方 SDK。此阶段完成公共 API 与平台边界拆分，不代表已经在 React Native、微信小程序或九号真实服务上完成新适配器验收。

## 包入口

| 入口                                   | 用途                                                        | 平台要求                                |
| -------------------------------------- | ----------------------------------------------------------- | --------------------------------------- |
| `@jiuhao/ninebot-client`               | `createNinebotSdk`、认证、会话、请求与适配器契约            | 无 Node/Electron 导入                   |
| `@jiuhao/ninebot-client/platform-web`  | Web Crypto 加密适配器                                       | Web Crypto、BigInt、TextEncoder/Decoder |
| `@jiuhao/ninebot-client/platform-node` | Node 加密适配器                                             | Node.js                                 |
| `@jiuhao/ninebot-client/track`         | 轨迹字符串解析、采样极速定位、插值、速度区间和 GeoJSON 计算 | 无网络、登录、存储或地图引擎依赖        |
| `@jiuhao/ninebot-client/node`          | 原根入口的 Node API 兼容集合                                | Node.js；包含研究工具，移动端不要导入   |
| `@jiuhao/ninebot-client/auth-node`     | 文件存储与两阶段登录的 Node 快捷工厂                        | Node.js                                 |

已有细分入口继续保留。`candidate-session` 仍是 Node 工厂，但已经使用共享服务实现；`candidate-session-core` 保留注入客户端的底层接口。`transport-web` 是共享 Fetch transport 的兼容别名，现已包含 Passport 和 Business 服务类型及认证重定向拒绝策略。

**迁移提示：** 以前从根入口导入 Node 工厂、文件存储或协议研究工具的代码，需要改为 `/node` 或对应专用子入口。仓库内桌面调用已迁移。默认桌面产品仍使用原 ninecli 运行时，SDK-only 的 opt-in 边界不变。

## 公共 API

构造 SDK 不产生请求。调用顺序为登录（或恢复）→ 车辆发现 → 月度行程 → 轨迹详情。

```ts
import {
  createNinebotSdk,
  createFetchNinebotTransport,
  defaultNinebotServiceEndpoints,
  createMemoryNinebotAuthSessionStore,
} from "@jiuhao/ninebot-client";
import { createNinebotWebCryptoAdapter } from "@jiuhao/ninebot-client/platform-web";
import { parseTrail, getTrackMaximumPoint } from "@jiuhao/ninebot-client/track";

const client = createNinebotSdk({
  transport: createFetchNinebotTransport({
    origins: Object.fromEntries(
      defaultNinebotServiceEndpoints.map(({ service, upstreamOrigin }) => [
        service,
        upstreamOrigin,
      ]),
    ),
    timeoutMs: 15_000,
  }),
  crypto: createNinebotWebCryptoAdapter(),
  // 示例只在内存保存；需要重启恢复时，注入宿主的安全存储。
  sessionStore: createMemoryNinebotAuthSessionStore(),
  // 由宿主提供稳定的设备上下文，不能每次请求重新生成 deviceId。
  deviceStore: secureDeviceStore,
});

await client.auth.restore(); // 仅恢复本地完整会话，不验证服务端有效性。
await client.auth.loginWithPassword({ areaCode: "86", user, password });

const vehicles = await client.vehicles.list({ service: "ebike", vehicleType });
const request = { service: "ebike" as const, serialNumber, vehicleType };
const month = await client.travels.list({ ...request, month: "202610" });
const detail = await client.travels.get({ ...request, travelId });

// durationSeconds 应由调用方从响应的实际时长字段归一化取得。
const points = parseTrail(detail.trail, durationSeconds);
const peak = getTrackMaximumPoint(points);
await client.auth.logout();
```

上例中的账号、车辆标识、设备存储和时长是宿主输入，不是 SDK 内置值。车辆类型与服务族继续显式传入，SDK 不猜测车型。车辆/轨迹响应保留现有协议数据结构，不能当作稳定的 UI 展示模型；共享车辆的权限校验与敏感字段展示仍由应用负责。

`auth` 同时提供 `requestSmsCode`、`loginWithSmsCode`、`refresh`、`whoami`、`getSession`、`getRefreshEligibility`、`observeDiagnostics`。服务端人机校验按现有错误类型返回。宿主展示正常验证界面后，可通过 `requestSmsCode({ areaCode, phone, validate })` 显式重试发码；`validate` 是本次用户验证产生的不透明结果，只用于该次请求的正文及签名，不会存储或自动重用。SDK 不代替用户完成验证，不自动重试挑战。只有 Passport 令牌和 Business UID 两阶段都成功后才持久化完整会话；密码不进入存储。

`travels.list` 默认逐页读取完整月份并验证总数、重复 ID、月份和汇总一致性。设置 `paginateTravelMonths: false` 只读取第一页，不承诺整月完整。业务读取会调用会话管理器按过期时间刷新；显式恢复、登录、刷新和退出会使旧读取失效。请求开始前的异步会话/设备加载、加密阶段，以及不遵守 AbortSignal 的迟到响应，都不能在会话失效后向调用方交付旧结果。

所有只读方法接受 `signal?: AbortSignal`，也支持底层 `headers` 扩展。应用不应允许用户覆盖认证相关头。`telemetry.status` 和 `telemetry.battery` 保留既有只读能力；移动产品可以只使用登录、车辆和轨迹。

### 短信登录与正常用户验证

宿主先请求发码；只有明确的人机验证拒绝才展示验证组件。下面的 `showVerification` 是宿主实现的 UI 回调：使用配置加载正常验证组件，让用户自行完成验证，成功返回组件的 `validate`，取消返回 `null`。它不是 SDK 自带的弹窗方法。

```ts
import { PassportLoginBusinessError, ninebotSmsVerification } from "@jiuhao/ninebot-client";

async function requestSms(
  phone: string,
  areaCode: string,
  showVerification: (
    config: typeof ninebotSmsVerification,
    signal: AbortSignal,
  ) => Promise<string | null>,
  signal: AbortSignal,
): Promise<boolean> {
  // 固定本次手机号；修改号码、切换方式或关闭面板时，由宿主 abort。
  const input = { phone, areaCode };
  signal.throwIfAborted();
  try {
    await client.auth.requestSmsCode({ ...input, signal });
    signal.throwIfAborted();
    return true;
  } catch (error) {
    if (
      !(error instanceof PassportLoginBusinessError) ||
      error.rejection !== "human-verification"
    ) {
      throw error;
    }
  }

  signal.throwIfAborted();
  const validate = await showVerification(ninebotSmsVerification, signal);
  signal.throwIfAborted();
  if (validate === null) return false;
  // 只重试一次。重复挑战继续抛错，不自动循环打开验证或发短信。
  await client.auth.requestSmsCode({ ...input, validate, signal });
  signal.throwIfAborted();
  return true;
}

// 发码成功且用户输入收到的短信验证码后：
await client.auth.loginWithSmsCode({ areaCode: "86", phone, code });
```

示例沿用上文构造的 `client`。宿主负责在取消时关闭验证界面；这里的 `signal` 贯穿宿主交互、SDK 异步签名和 transport；取消后不会开始新的发码请求，也不会接受迟到成功，但不能撤回已经提交给服务器的发码请求。自定义 transport 应传递该信号给平台网络 API。验证结果不应进入日志、持久存储或应用状态快照。`ninebotSmsVerification` 来自固定版本的官方 Android 包，不保证配置跨版本、跨平台永久有效；真实验收与证据范围见 [短信验证接入](../../docs/AUTH_SMS_VERIFICATION.md)。

## 平台适配契约

- **`NinebotTransport`**：发送固定结构的请求，返回 HTTP 状态、响应头和字节数组。实现必须保留二进制数据、支持取消，并阻止 Passport 签名请求被自动重定向到其他位置。
- **`NinebotCryptoAdapter`**：提供安全随机 nonce、Passport 签名，以及异步 `encode`。每次 `encode` 返回自己的 `decode` 闭包，响应密钥上下文不得跨请求共享。
- **`NinebotAuthSessionStore`**：异步 `load/save/clear`，只保存完整会话。移动端应接系统安全存储，不使用普通明文偏好存储保存令牌。
- **`deviceStore`**：提供 `load()`，返回稳定的 `deviceId/region/osVersion/osModel`。这些值是协议上下文，默认 Android wire 字段不代表宿主必须是 Android。
- **`responseBodyDecoder`**：可选解压边界。默认读取 `response.body`；若 transport 返回未解压的 gzip 字节，必须注入解压器。Node 可用 `/response-node` 的 `decodeGzipBody`，自动解压的 Fetch 不应重复解压。

Node 调用方可以对同一个 `createNinebotSdk` 注入 `createNinebotNodeCryptoAdapter()`、`createFileNinebotAuthSessionStore()`、`createFileNinebotDeviceContextStore()` 和 `decodeGzipBody`。已有 `createNinebotNodeAuthSessionManager` 也已改为使用共享认证组装，不维护第二份业务登录规则。

Web 适配器使用 AES-CBC、SHA-256 和安全随机数；RSAES-PKCS1-v1_5 由现有 BigInt 实现完成。原生移动环境若缺少相应 Web Crypto 能力，可以实现同一适配器接口，无需改协议或会话代码。核心仍需要标准 Promise、Uint8Array、TextEncoder/Decoder、AbortController/Signal 与所用 ES2023 方法，宿主需验证这些能力。

浏览器直接访问官方服务受 CORS 与受限请求头约束；离线浏览器验收不证明官方接口允许浏览器直连。React Native 需要核验手动重定向、二进制与解压行为；微信小程序需要自己的请求适配和正式环境域名验证。公共包不会绕过平台网络限制。

## 轨迹分析

`track` 入口不导入 SDK 登录或任何平台适配器。桌面主进程的 `parseTrail` 和渲染层的轨迹计算已经引用该入口，避免两端维护不同极速算法。`getTrackMaximumPoint` 返回采样峰值及索引，不把它宣称为物理测量真值，也不自动剔除 GPS 异常点。`offsetSeconds` 仍按总时长插值估算，因为原轨迹字符串没有逐点时间戳。现有五档配色与键盘/SVG 计算作为兼容辅助保留，应用可以自行选择呈现方式。

## 构建与验证

在仓库根目录运行：

```sh
pnpm --filter @jiuhao/ninebot-client build
pnpm --filter @jiuhao/ninebot-client typecheck:browser
pnpm exec vitest run packages/ninebot-client/src
pnpm run qa:sdk-portability
```

`typecheck:browser` 在不加载 Node 类型的配置下检查公共入口、声明依赖和 Web 适配器。`qa:sdk-portability` 会打包到临时目录、解包、检查 JS/声明的传递依赖、编译独立消费者，并在真实 Chromium 中导入成品，完成合成数据的两阶段登录、车辆、月度、轨迹、极速计算、恢复与退出；结束清理测试目录和浏览器。不使用真实账号，不访问九号接口，不打开桌面产品窗口。

SDK 测试使用同一加密协议对端覆盖 Node 与 Web 适配器，并验证分页、并发响应密钥隔离、过期刷新、认证失败不落盘、退出后迟到数据丢弃，以及加密过程取消后不发送请求。既有桌面与协议测试继续保留。

## 分发边界

该包当前零生产依赖；本地 tarball 包含 `dist` 与 README。原根入口迁移属于尚未发布的 `0.0.0` API 调整。首次公开发行前仍需确定包名/版本策略、许可证与协议材料分发依据，并完成目标平台的真实登录、自然刷新、短信挑战和轨迹验收。本次不修改 npm 账号、不上传包、不宣称官方授权。

实现与验收背景见仓库中的 [认证验收](../../docs/AUTH_PHASE1.md)、[桌面验收](../../docs/DESKTOP_ACCEPTANCE.md)和 [ninecli 替代记录](../../docs/NINECLI_REPLACEMENT.md)。这些仓库相对链接仅用于源码阅读，不是 npm 包的运行依赖。

## 多账号宿主

SDK 实例拥有各自的认证生命周期与注入的 session/device store。多账号宿主应为每个账号创建独立实例和独立存储，保留 access token、refresh token、业务 UID 及对应设备上下文，切换时选择该实例并废弃旧请求的展示结果。不要只把不同账号的 access token 填进一个共享实例或混用设备上下文。

本仓库桌面端的本机账号目录位于主进程宿主层，页面只接收不透明本地 ID 和脱敏标识。现有单账号 SDK API 保持可用，移动端可按同样实例隔离方式提供自己的安全存储适配器；桌面文件目录本身不是跨端接口。
