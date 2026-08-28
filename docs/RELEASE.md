# 桌面端发布说明

当前验证 macOS Apple Silicon 与 Windows x64。这里把“测试包”和“稳定正式包”明确分开，避免把生成安装程序误认为已经完成平台签名与信誉闭环。

## 本机验收包

```bash
pnpm package:mac:local
```

该命令会：

1. 执行 TypeScript 构建与 electron-vite 生产构建。
2. 生成 ad-hoc 签名的 `.app`、DMG 和 ZIP。
3. 验证 Bundle ID、版本、架构、ASAR 内容、Electron Fuses 和代码签名完整性。
4. 确认包内没有令牌、车辆缓存、配置文件或 ninecli 二进制。
5. 生成 `release/SHA256SUMS.txt`。
6. 使用接近 Finder 的精简 `PATH` 启动成品，验证 UI、预加载桥接及 `~/.local/bin/uvx` 定位。
7. 主动终止一次渲染进程，确认本地恢复页出现并能重新进入主界面。

ad-hoc 签名不能建立发布者身份，也没有 Apple 公证票据，其他 Mac 的 Gatekeeper 可能阻止运行。这类产物只能作为明确标注风险的 GitHub prerelease 测试版，不能冒充稳定公开版。

## GitHub 测试版发布

推送与 `package.json` 版本一致的 `v*` 标签会触发 `.github/workflows/release.yml`。GitHub Actions 分别在 Apple Silicon 与 Windows x64 runner 上重新执行完整检查：macOS 生成 ad-hoc DMG/ZIP；Windows 生成未签名的 NSIS 安装程序/ZIP，并完成解包、运行时、静默安装、安装后启动和卸载入口验收。两个平台都成功后，单独的发布任务才会合并资产、生成统一校验清单并创建 prerelease；本地命令不上传 Release 资产。

```bash
git tag v0.1.0
git push origin v0.1.0
```

工作流只接受精确指向 `main` 当前提交的版本标签，且会校验标签版本、安装包内容、SHA-256 清单、ASAR、Electron Fuses、平台签名状态、崩溃恢复和成品启动。正式稳定版仍必须完成下方的平台签名边界。

## 正式签名包

正式构建入口：

```bash
pnpm release:mac
```

运行前必须具备：

- 有效的 Apple Developer Program 会员资格。
- `Developer ID Application` 证书。
- 一组公证凭据，优先使用 App Store Connect API Key。

推荐在 CI Secret 中提供：

```text
CSC_LINK
CSC_KEY_PASSWORD
APPLE_API_KEY
APPLE_API_KEY_ID
APPLE_API_ISSUER
```

也可以使用 Apple ID 方案：

```text
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

`release:mac` 强制要求代码签名；产物验收还会要求 Developer ID Authority、Gatekeeper 接受和有效的 stapled notarization ticket。任一条件缺失都会失败，而不是静默产出“看起来像正式版”的未签名包。

Windows 测试版目前没有 Authenticode 证书，Microsoft Defender SmartScreen 可能警告或阻止运行。稳定 Windows 版需要可信的代码签名证书与可持续的签名流程；不能仅因为 NSIS 安装成功就称为正式签名版。

## ninecli 与 uv 边界

- 当前包不内置 `uv` 或 `ninecli`。
- 使用者需要先按 [uv 官方安装说明](https://docs.astral.sh/uv/getting-started/installation/)安装，例如 `brew install uv`。
- macOS 从 `PATH`、`~/.local/bin`、`~/.cargo/bin`、`/opt/homebrew/bin` 和 `/usr/local/bin` 查找 `uvx`；Windows 从用户 `PATH`、`%USERPROFILE%\.local\bin`、`%USERPROFILE%\.cargo\bin` 和 WindowsApps 查找 `uvx.exe`。
- 应用只请求 `ninecli==0.1.7`，并在执行前分别校验 macOS arm64 与 Windows x64 二进制的固定 SHA-256。
- [PyPI 元数据](https://pypi.org/project/ninecli/0.1.7/)把 ninecli 标为 MIT，但 0.1.7 wheel 中没有许可证正文、版权声明或项目链接。公开发布前应取得可归档的原始许可证/源码仓库证据，或者继续保持由使用者本机通过 uv 获取，不把二进制放入韭号出行安装包。

签名与公证要求以 [electron-builder macOS 文档](https://www.electron.build/docs/mac/)和[公证文档](https://www.electron.build/docs/notarization/)为准。

## 当前产物

```text
release/mac-arm64/韭号出行.app
release/ninebot-desktop-0.2.0-mac-arm64.dmg
release/ninebot-desktop-0.2.0-mac-arm64.zip
release/SHA256SUMS.txt
```

Windows x64 还会生成：

```text
release/win-unpacked/韭号出行.exe
release/ninebot-desktop-0.2.0-win-x64.exe
release/ninebot-desktop-0.2.0-win-x64.zip
```

版本更新后文件名会随 `package.json` 中的版本自动变化；GitHub Release 中的 `SHA256SUMS.txt` 同时覆盖四个公开资产。
