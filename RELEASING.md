# msgcode Desktop - 开源发布指南

> 目标：让贡献者在本地完成“构建 + 启动 + 默认验收”，并明确哪些 Demo 属于手动场景。

## 快速验收（3 分钟）

```bash
# 1) 构建 Desktop Host（生成 MsgcodeDesktopHost.app）
bash mac/MsgcodeDesktopHost/build.sh

# 2) 构建 desktopctl
cd mac/msgcode-desktopctl && swift build

# 3) 启动 Host（LaunchAgent + Mach service）
bash mac/MsgcodeDesktopHost/register_launchagent.sh install

# 4) 默认验收（环境无关）
npx tsx scripts/desktop/run-recipe.ts recipes/desktop/token_test_v0.json
```

## Manual Demo（Terminal 回显）

这是手动 Demo，不作为 CI/开源默认验收（受前台应用/焦点/输入法影响）。

前置条件：
1. 打开 Terminal.app 并置为前台
2. 点击输入区聚焦
3. 确保已授予辅助功能 + 屏幕录制权限

运行：

```bash
npx tsx scripts/desktop/run-recipe.ts recipes/desktop/terminal_echo_v0.json
```

## 故障排查

### 权限检查

```bash
npx tsx src/cli.ts /desktop doctor
```

### LaunchAgent 状态

```bash
bash mac/MsgcodeDesktopHost/register_launchagent.sh status
```

### 重启 Host

```bash
bash mac/MsgcodeDesktopHost/register_launchagent.sh uninstall
bash mac/MsgcodeDesktopHost/register_launchagent.sh install
```

## 架构概览

- `msgcode`（Client）：策略、确认、审计（不直接触碰 TCC/AX/截图）
- `MsgcodeDesktopHost.app`：权限宿主（`NSXPCListener`），执行 Desktop 原语并落盘证据
- `msgcode-desktopctl`：CLI 代理（支持 `session` 长连接模式）

更多细节见 `mac/README.md` 与 `docs/desktop/`。

