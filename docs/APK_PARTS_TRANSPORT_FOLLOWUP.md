# 部件查询传输链续查与具体边界（2026-10-21）

基线 `fea8ed3`。本轮继续上次未闭合的动态 host、配置选择、SDK 初始化与互操作研究，未把“接口有字段”当作可用客户端。仅使用既有官方 APK/DEX、本地静态解析器和系统已有 Apple LLVM objdump 17；未运行 APK、SDK、native 库或真实请求，未读取真实账号、配置缓存、NativeSecrets 返回值或运行实例。

## 本轮已闭合什么

| 问题               | 新证据                                                                                                                                                | 状态                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 服务域从哪里来     | NbHttpHostManager31289（35345412）加载 APK assets/Server.json；31295 读取 production                                                                  | 静态来源已闭合                              |
| 怎么按车型选 host  | vehicleType 当 serverId，1425（59867068）查 supports_devices 对应配置；2685/2717 按 hostKey 查 NbHttpHostManager，失败回退 ScanDeviceConfig.serverMap | 选择算法已闭合；具体车型条目未取得          |
| 有没有内置车型回退 | BackupClient2612（69484956）读 backup_config.nb，69485034 调用 AES 解密，再 Gson→BackupConfig；2619 按当前区域匹配 applyRegion                        | 结构闭合；按本轮限制停在解密前              |
| 策略默认值         | RemoteConfigData29472 的 yidun_security 默认 ver=3/token=false；Config31642 同样默认                                                                  | 默认值已确认，不能代替当前策略              |
| 实际策略来源       | Manifest 绑定 HwRemoteConfigClient，读取 AGConnect 上次获取的值，fetch 后 apply；解析后写 configCache                                                 | 读取/更新/写入链闭合；真实值未读            |
| SDK 如何初始化     | 主进程初始化 NetSecKit；协议同意相关初始化另行启动 HTProtect，参数包含 applicationContext 和 NativeSecrets productId 返回对象                         | Java 调用与必要输入已闭合，未读取 productId |
| 能否套用现有 SDK   | Java 内层有 serviceTime/nonce/大写 MD5 checkcode，但外层加密进入两套 native 接口；无算法/密文向量等价证据                                             | 不能据此判定互操作或实现可用客户端          |

## 公开 host 来源与剩余具体输入

assets/Server.json：5831 字节，APK ZIP header offset154441780，SHA256 `e5f0dde22dd80a36ba2945bce0e0ac01b2f03117415fdc82634b1246ea977a8c`。以下均为内置 production 域，不是本轮访问或新增接收方：

| hostKey        | 国内                           | 海外                               |
| -------------- | ------------------------------ | ---------------------------------- |
| ebike          | https://ebike.ninebot.com      | https://ebike-os.ninebot.com       |
| steeldust      | https://steeldust.ninebot.com  | https://steeldust-os.ninebot.com   |
| assisted_ebike | https://cnnx-omsgw.ninebot.com | https://eu-oms-gateway.ninebot.com |

getHostConfigByHostKey2717（59954140）先查 NbHttpHostManager（含 key 映射与正式/测试选择），两个 host 值可用时构造 ServerHostConfig，否则回退 serverMap。MotorApiSource25899（46209204）把 DeviceBean.vehicleType 作为 serverId 查询配置；不能由某个已知域名推断所有车型。

实际缺的输入已缩小为：该车型的 supports_devices/serverId 条目及 hostKey、国内/海外和正式/测试选择、可选测试 host override。远端扫描配置也可覆盖 APK 回退。没有读取本机真实设置或缓存。内置 backup_config.nb 需要经过 AES 解密；本轮不提取/使用密钥材料，不解密该资源，也未产生明文映射产物。

## 配置并非一个固定常量

- RemoteConfigData29472 在35217182–35217204注册 yidun_security，默认 ver=3/token=false。YiDunSecurityPolicy.isNewEncrypt31654 只在 ver==4 时选择新算法；默认与实际下发值必须区分。
- AndroidManifest.xml chunk78032 指定 com.ninebot.remote_config_client=cn.ninebot.library.hwremoteconfig.HwRemoteConfigClient；chunk78132 指定 cache_seconds=60。60 是 SDK 参数，不是已证实的固定轮询周期。
- RemoteConfigClient8448（60342168）通过 metadata 反射构造实现，失败有 Empty 回退。HwRemoteConfigClient4545（60074036）调用 loadLastFetched().getValueAsString；4551（60073860）调用 fetch(cacheSeconds)，4532（60073340）成功后 apply(ConfigValues)。本轮没有调用这些 API。
- getYiDunSecurityConfigCache29556→29557→getRemoteConfig29541→loadAllConfigCache29562→getConfig29520→parseAndCacheConfig29564；最后 Map.put 在35222404。首次读取与后续更新均可能改变所用配置，因此 APK 默认不能决定特定请求的实际分支。
- token 许可另有 UID 相关远端来源：NBApplication.refreshRiskPermissions3160→fetchAppPermissions(uid)→校验登录身份和返回值→setTokenWhitelist。该资料不是匿名公共配置，未请求或读取。

## 初始化、native 断点与互操作范围

旧链：NBApplication.initForMainProcess3132 的69518800→NeteaseDecrypt.init8294（60318648）→SecruityInfo(Context)→GenInfoImpl/GenInfoFactory，保存 Android Context。SecruityInfo.encryptStringToServer61514（100716928）把字符串编码后交给 getEncryptJson；GenInfoFactory61455（100715176）在100715184调用 native JNIFactory.w3270a03dafee4a0a(Object,String)，method61469/access257/code0。解密61453（100715104）经100715112进入 native61466。

新链：NBApplication.initAgreementDependent3119 先配置 token 白名单，在69517538调用 YiDunRiskSecurity.init31639。其参数含 applicationContext、NativeSecrets.getYdProductId() 返回对象、null callback 和 HTProtectConfig；未读取该返回值。HTProtect.init61993→factory64640→native64631（Context,String,callback,config）。加密从 safeCommToServerByteV30(32,0,UTF8(JSON),false) 经 factory64643 进入 native64633，签名为 byte[]、两个 int、boolean、int、boolean。Java 结构不能证明 SDK 可脱离 Android 初始化在 Node 中复用。

最终保留的 native 分析为 APK arm64 两个库的 ELF 元数据及按符号大小限定的 JNI_OnLoad 反汇编，未加载它们：

| 库                    | SHA256                                                             | JNI_OnLoad 范围    |
| --------------------- | ------------------------------------------------------------------ | ------------------ |
| libnetseckit-4.3.1.so | `e1adee6619d7abb72a628fb6884175c2df7b74ed263cbf487655ffd9031e317d` | 0x5c888，432 字节  |
| libNetHTProtect.so    | `09ed689f3e1ba1f85a880faf76a291451a92da9b6d225ba871bbd2933f4a864a` | 0x25bfa8，236 字节 |

没有相应 JNI 加/解密方法的命名导出；有界字面搜索也没有取得现有 SDK 的 keyDataOne 等 wrapper 证据。阴性搜索不证明不兼容；JNI_OnLoad 分支也不是算法证明。本轮不解包/绕过 native 保护，不取内部密钥。分析用两个派生库副本经哈希核对后已删除，原 APK 保留。

现有 SDK 的 crypto-codec 明确采用 d/h/k/p/t 外壳和 AES/RSA 候选实现，来源是 ninecli 的已恢复协议。APK 的 NeteaseDecrypt 8291/8297/8298可确认 nonce 与大写 MD5 checkcode；getServiceTime 使用 elapsedRealtime 与 mTimeDifference。共享字段或 MD5 形态不足以证明外层相同；本轮没有针对部件接口的脱敏成功样本、受支持的 native 协议合同或合成明文测试向量，因此未复用该候选加密器发送请求。

## 本轮终点与可行下一步

本轮终点是明确的静态输入/实现边界：公开域和选择算法已确认；具体车型回退映射停在 AES 资源；真实策略由远端配置决定；密文构造停在上述 native 接口。不能只凭 APK 默认值选择算法，也不能以读取旧会话、提取密钥、强制真实请求或绕过保护补齐缺口。没有新增客户端或把 DTO/合成测试算作业务功能完成。

可行下一步是取得合法提供的非秘密配置样例（serverId/hostKey、区域/环境、ver/token），以及供应方支持的加密协议/无账号离线测试向量，分别验证路由和密文互操作。配置样例本身不能替代算法证明。不需要真实账号、令牌、位置或旧登录数据；在兼容性证据到位前不接入当前实例。

证据索引见 [APK_VEHICLE_READ_EVIDENCE.json](APK_VEHICLE_READ_EVIDENCE.json) 的 transportFollowUp。完整、字符串省略的调用链在任务目录 business-capabilities-20261021；21个非根候选中20个通过交叉校验，所选369方法中的有代码方法解码错误0，base73879344仍跳过。没有 REA/Hopper 成功声明。

一次本地静态预览的常量过滤不充分，已停止该分支并检查/清理新建证据中的字符串正文；未执行资源解密或生成明文产物。报告和提交不保留该常量，未宣称已撤回既有本地工具输出。补充发现的 YiDunPassportSecurity.install 仅记录为独立线索：旧区域搜索的阴性不能外推至新增区域；本轮不扩展认证改动。
