# 安全政策

韭号出行会在本机处理九号登录令牌、车辆状态和骑行轨迹，因此凭据泄露、越权车辆控制、位置数据越界、预加载桥接逃逸和依赖完整性绕过都属于高优先级安全问题。

请不要在公开 Issue 中提交令牌、密码、验证码、车辆 SN、九号内部行程 ID、精确经纬度或可识别个人的截图。安全问题请使用仓库的 [Private vulnerability reporting](https://github.com/cixiangtao/ninebot-desktop/security/advisories/new) 私下报告，并提供最小复现、受影响版本和影响说明。

当前只维护最新 prerelease；未签名、未公证和非官方 ninecli 依赖的已知边界见 [发布说明](../docs/RELEASE.md)。
