# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-02-11

### Added
- **Message -> Safari 端到端能力**: Desktop Bridge 基础设施
  - `desktop.hotkey` - 发送快捷键（cmd+l, enter 等）
  - `desktop.typeText` - 通过剪贴板输入文本
  - `desktop.observe` - 截图 + AX 树证据落盘
  - `desktop.click` - 点击 UI 元素（需 confirm token）
  - `desktop.find` - 查找 UI 元素
  - `desktop.waitUntil` - 等待 UI 条件成立
  - `desktop.listModals` - 列出模态窗口
  - `desktop.dismissModal` - 关闭模态窗口
  - `desktop.abort` - 中止正在执行的请求
- LaunchAgent 支持：Mach Service 长期运行
- 测试钩子系统（`desktop._test.*`）：
  - `desktop._test.injectModalDetector` - 注入 mock modal 检测器
  - `desktop._test.clearModalDetector` - 清除 mock modal 检测器
- 安全机制：
  - Confirm Token 一次性确认
  - Allowlist 白名单验证
  - Evidence 证据强制落盘 workspace 内
  - Abort 中止能力
- 冒烟测试脚本：`scripts/desktop/smoke-message-safari.sh`

### Changed
- 架构变更：Bridge Server 从独立 XPC Service 改为内置 HostApp 进程
- TCC 权限检查现在指向 HostApp（com.msgcode.desktop.host）

### Security
- 测试钩子需要同时满足：
  1. 环境变量 `OPENCLAW_DESKTOP_TEST_HOOKS=1`
  2. 请求参数 `meta._testMode=true`
- LaunchAgent 支持通过 `install --test` 启用测试模式

### Testing
- 单元测试：417 个测试全部通过
- Safari E2E 冒烟测试验证通过
- 验收 executionId 示例（v1.0.0）：
  - hotkey cmd+l: `0F4C464C-6A5D-41FC-A780-1E7824BC4C4F`
  - typeText URL: `61DE7C34-D2F9-4715-AD23-14F9EBB0F832`
  - hotkey enter: `85B6A98B-5063-4BEA-B3F9-2FAA05784EA4`
  - observe: `E8D717C8-551F-4622-959B-E93C48B81744`

### Known Limitations
- macOS 仅（依赖 AXUIElement API）
- 需要辅助功能和屏幕录制权限
- Safari 以外的应用支持待验证
- 复杂 UI 场景（如多级菜单、动态内容）需进一步测试

### Documentation
- `docs/desktop/README.md` - Desktop Bridge API 文档
- `mac/MsgcodeDesktopHost/README.md` - HostApp 架构与使用
- `mac/MsgcodeDesktopHost/docs/desktop/README.md` - LaunchAgent 与测试钩子

[1.0.0]: https://github.com/yourorg/msgcode/releases/tag/v1.0.0
