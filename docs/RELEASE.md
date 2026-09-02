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
4. 确认包内没有令牌、车辆缓存或配置文件，并核对资源目录内置 ninecli 的架构与固定摘要。
5. 生成 `release/SHA256SUMS.txt`。
6. 使用接近 Finder 的精简 `PATH` 启动成品，验证 UI、预加载桥接及内置数据组件，不依赖 Python、uv 或用户 `PATH` 中的 ninecli。
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

## ninecli 内置边界

- 安装包只内置当前平台的 `ninecli==0.1.7` 原生可执行文件，不包含 Python、uv、完整 wheel 或其他平台文件；使用者无需额外安装依赖。
- 构建脚本从固定的 `files.pythonhosted.org` URL 下载对应 wheel，先校验 wheel SHA-256，再只提取 `ninecli/bin/ninecli` 或 `ninecli/bin/ninecli.exe` 并校验第二个 SHA-256。任一环节不一致都停止构建。
- 成品验收再次检查 macOS arm64 或 Windows PE x64 架构与固定摘要；macOS 摘要排除签名容器及 `__LINKEDIT` 签名尺寸字段，并另行验证代码签名，因此 ad-hoc 与 Developer ID 重签不会伪装成程序内容变化。应用每次执行前还会校验同一口径，不回退到 `PATH`、uvx 或用户自行安装的 ninecli。
- [PyPI 元数据](https://pypi.org/project/ninecli/0.1.7/)把 ninecli 标为 MIT，但 0.1.7 wheel 中没有独立许可证正文、版权声明或项目链接。当前安装包选择再分发该二进制，并在 `THIRD_PARTY_NOTICES.md` 中保留元数据来源与证据缺口；这不等同于已经取得更完整的上游源码或授权证明。

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
