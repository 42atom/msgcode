# Desktop Host

MsgcodeDesktopHost 是 macOS 桌面自动化桥接服务，通过 XPC 协议提供 UI 自动化能力。

## 权限要求

首次运行需要授予以下权限：

- **辅助功能**（Accessibility）：用于观察和控制 UI 元素
- **屏幕录制**（Screen Recording）：用于屏幕截图

授权路径：系统设置 → 隐私与安全性 → 辅助功能/屏幕录制

## RPC 方法

### 核心方法

- `desktop.find` - 查找 UI 元素
- `desktop.click` - 点击元素
- `desktop.typeText` - 输入文本
- `desktop.hotkey` - 发送快捷键
- `desktop.highlight` - 高亮显示元素（调试用）
- `desktop.waitUntil` - 等待 UI 条件成立
- `desktop.listModals` - 列出模态窗口
- `desktop.dismissModal` - 关闭模态窗口
- `desktop.abort` - 中止正在执行的请求

## 测试钩子（Test Hooks）

### 概述

部分测试专用的 RPC 方法（前缀为 `desktop._test.*`）仅在测试环境中开放，生产环境默认禁用。

### 启用方式（T16.0.6 统一策略）

测试钩子需要**同时满足**以下两个条件才能启用：

1. **环境变量**：`OPENCLAW_DESKTOP_TEST_HOOKS=1`
2. **请求参数**：`meta._testMode === true`

### LaunchAgent 安装方式（推荐）

由于 macOS GUI 应用通过 `open` 启动时**不继承 shell 环境变量**，推荐使用 LaunchAgent 安装方式：

```bash
# 安装 LaunchAgent（生产模式 - 测试钩子禁用）
./register_launchagent.sh install

# 安装 LaunchAgent（测试模式 - 启用测试钩子）
./register_launchagent.sh install --test

# 查看 LaunchAgent 状态
./register_launchagent.sh status

# 卸载 LaunchAgent
./register_launchagent.sh uninstall
```

**注意**：测试模式安装后，若要切换回生产模式，需先卸载再重新安装：
```bash
./register_launchagent.sh uninstall
./register_launchagent.sh install
```

### 直接启动方式（不推荐用于测试）

```bash
# 直接启动（生产模式 - 测试钩子禁用）
open /path/to/MsgcodeDesktopHost.app

# 通过可执行文件启动（可继承 shell 环境，用于调试）
export OPENCLAW_DESKTOP_TEST_HOOKS=1
/path/to/MsgcodeDesktopHost.app/Contents/MacOS/MsgcodeDesktopHost
```

**为什么 `open` 不继承环境变量？**
- macOS GUI 应用通过 `open` 启动时，由 launchd 管理，不继承当前 shell 的环境变量
- 使用 LaunchAgent 的 `EnvironmentVariables` 配置可确保环境变量正确传递
- 或直接运行可执行文件（而非 .app）可继承 shell 环境

### RPC 请求格式

在 RPC 请求的 `meta` 中添加 `_testMode: true`：

```json
{
  "meta": {
    "workspacePath": "/path/to/workspace",
    "requestId": "test-001",
    "_testMode": true
  },
  "method": "desktop._test.injectModalDetector",
  "params": { ... }
}
```

### 可用测试钩子

| 方法 | 说明 |
|------|------|
| `desktop._test.injectModalDetector` | 注入模拟 modal 检测器（用于单元测试） |
| `desktop._test.clearModalDetector` | 清除模拟 modal 检测器 |

### 安全说明

- 生产环境调用测试钩子将返回 `DESKTOP_INVALID_REQUEST`（unknown method）
- 测试脚本应使用 `_testMode` 参数明确标识测试意图
- 构建脚本应确保该环境变量不会带入发布环境

### 示例

```typescript
// 测试脚本中使用 callTestHook 包装方法
const result = await session.callTestHook("desktop._test.injectModalDetector", {
  mockModals: [{ role: "AXDialog", pid: 1234 }]
});
```

## Evidence 目录

执行记录和证据文件保存在：

```
<workspace>/artifacts/desktop/YYYY-MM-DD/<executionId>/
├── events.ndjson      # 事件日志
├── modals.json        # Modal 列表（listModals）
└── screenshot.png     # 截图（如适用）
```

## 版本

- Host Version: 0.1.0
- Schema Version: 1
