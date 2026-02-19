# Release Notes v1.0.0

## Message -> Safari 里程碑基线

**发布日期**: 2025-02-11
**版本**: v1.0.0
**里程碑 tag**: v1.0-milestone-safari

---

## 概述

v1.0.0 是 msgcode Desktop Bridge 的首个里程碑版本，实现了 **Message -> Desktop -> Safari** 的端到端闭环能力。此版本已通过完整的自动化验收测试，核心链路稳定可追溯。

### 核心能力

```
Message → Desktop Bridge → Safari
            ↓
        hotkey cmd+l
        typeText URL
        hotkey enter
        observe (screenshot + AX tree)
```

---

## 能力范围

### 1. 核心 RPC 方法

| 方法 | 说明 | 需确认 |
|------|------|--------|
| `desktop.ping` | 健康检查 | ❌ |
| `desktop.doctor` | 权限诊断 | ❌ |
| `desktop.observe` | 截图 + AX 树落盘 | ❌ |
| `desktop.find` | 查找 UI 元素 | ❌ |
| `desktop.click` | 点击元素 | ✅ |
| `desktop.typeText` | 输入文本（剪贴板粘贴） | ✅ |
| `desktop.hotkey` | 发送快捷键 | ✅ |
| `desktop.waitUntil` | 等待 UI 条件 | ❌ |
| `desktop.listModals` | 列出模态窗口 | ❌ |
| `desktop.dismissModal` | 关闭模态窗口 | ✅ |
| `desktop.abort` | 中止请求 | ❌ |

### 2. 测试钩子（Test Hooks）

| 方法 | 说明 | 启用条件 |
|------|------|----------|
| `desktop._test.injectModalDetector` | 注入 mock modal 检测器 | `OPENCLAW_DESKTOP_TEST_HOOKS=1` + `_testMode=true` |
| `desktop._test.clearModalDetector` | 清除 mock modal 检测器 | 同上 |

---

## 已验证链路

### Safari 自动化（端到端验收通过）

**场景**: 打开 Safari 并访问 example.com

```
步骤 1: hotkey cmd+l         → executionId: 0F4C464C-6A5D-41FC-A780-1E7824BC4C4F
步骤 2: typeText URL          → executionId: 61DE7C34-D2F9-4715-AD23-14F9EBB0F832
步骤 3: hotkey enter          → executionId: 85B6A98B-5063-4BEA-B3F9-2FAA05784EA4
步骤 4: observe (验证)        → executionId: E8D717C8-551F-4622-959B-E93C48B81744
```

**证据路径**:
```
artifacts/desktop/2026-02-11/E8D717C8-551F-4622-959B-E93C48B81744/
├── screenshot.png     (最终页面截图)
├── ax.json           (AX 树)
├── env.json          (环境信息)
└── events.ndjson     (事件流)
```

### 回归测试脚本

```bash
scripts/desktop/smoke-message-safari.sh
```

一键执行全部 4 步，输出所有 executionId 和 evidence 路径。

---

## 安全机制

### 1. Confirm Token

所有危险操作（click, typeText, hotkey, dismissModal）需要一次性确认令牌。

### 2. Allowlist 白名单

仅允许授权的 peer 调用 Bridge Service。

### 3. Evidence 证据落盘

所有操作必须将证据落盘到 workspace 内的 `artifacts/desktop/` 目录。

### 4. Abort 中止能力

可随时中止正在执行的请求。

### 5. 测试钩子双门禁

测试专用方法需要**同时满足**：
- 环境变量: `OPENCLAW_DESKTOP_TEST_HOOKS=1`
- 请求参数: `meta._testMode=true`

---

## 已知限制

| 限制项 | 说明 | 后续计划 |
|--------|------|----------|
| 平台 | 仅支持 macOS | - |
| 权限 | 需辅助功能 + 屏幕录制 | 文档说明已完善 |
| 应用支持 | 仅验证 Safari | 其他应用待测试 |
| 复杂 UI | 多级菜单、动态内容 | 待增强 |
| 文档排除 | `AIDOCS/` 不随发布 | .gitignore 已配置 |

---

## 部署方式

### LaunchAgent（推荐）

```bash
cd mac/MsgcodeDesktopHost

# 生产模式
./register_launchagent.sh install

# 测试模式
./register_launchagent.sh install --test
```

### GUI 模式

```bash
open mac/MsgcodeDesktopHost/MsgcodeDesktopHost.app
```

**注意**: GUI 模式不继承 shell 环境变量，测试钩子需用 LaunchAgent 启用。

---

## 回滚方式

### 回滚到上一版本

```bash
git checkout v0.9.0  # 假设上一版本
```

### 卸载 LaunchAgent

```bash
cd mac/MsgcodeDesktopHost
./register_launchagent.sh uninstall
```

### 清理权限

```bash
sudo tccutil reset Accessibility com.msgcode.desktop.host
sudo tccutil reset ScreenCapture com.msgcode.desktop.host
```

---

## 验证命令

```bash
# 1. 健康检查
mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl doctor --workspace .

# 2. 冒烟测试
scripts/desktop/smoke-message-safari.sh

# 3. 单元测试
npm run test:all
```

---

## 文档索引

- **API 契约**: `docs/desktop/contract.md`
- **使用指南**: `docs/desktop/README.md`
- **HostApp 架构**: `mac/MsgcodeDesktopHost/README.md`
- **LaunchAgent 管理**: `mac/MsgcodeDesktopHost/register_launchagent.sh`
- **测试钩子说明**: `mac/MsgcodeDesktopHost/docs/desktop/README.md`

---

## 下一步计划

1. **分支保护**: 设置 main 分支 PR 必审 + CI 必过
2. **CI 门禁**: 将 smoke-message-safari.sh 纳入 CI 流程
3. **扩展应用支持**: 验证 Finder、Telegram 等应用
4. **复杂 UI 增强**: 多级菜单、动态内容处理

---

## 发布检查清单

- [x] 单元测试: 417 pass, 0 fail
- [x] Safari E2E: 冒烟测试通过
- [x] 证据落盘: screenshot + AX tree 完整
- [x] 文档同步: README 已更新
- [x] Tag 创建: v1.0.0 + v1.0-milestone-safari
- [x] AIDOCS 排除: 验证通过（见下方命令）

```bash
git archive --format=tar HEAD | tar -tf - | rg "^AIDOCS/" || echo "NO_AIDOCS_OK"
# 输出: NO_AIDOCS_OK ✅
```

---

**v1.0.0 基线冻结完成** ✅

保持 `main` 分支稳定，所有后续改动通过 PR + CI 门禁。
