# msgcode Desktop Bridge

macOS 本地 UI 自动化能力（截图/AX树/点击/输入/快捷键）

---

## 快速开始

### 步骤 1: 启动 Desktop Host

```bash
# 打开 MsgcodeDesktopHost.app（首次需授予权限）
open mac/MsgcodeDesktopHost/MsgcodeDesktopHost.app

# 或通过 Menubar 验证：点击 "Doctor" 查看权限状态
```

### 步骤 2: 检查权限

系统设置 → 隐私与安全性 → 辅助功能 ✓
系统设置 → 隐私与安全性 → 屏幕录制 ✓

### 步骤 3: 发起请求

```bash
# 健康检查
npx tsx src/cli.ts /desktop health

# 截图 + AX 树（落盘到 workspace/artifacts/desktop/）
npx tsx src/cli.ts /desktop observe

# 查找 UI 元素
npx tsx src/cli.ts /desktop find --byRole AXButton --titleContains "Send"

# 点击元素（需 confirm）
npx tsx src/cli.ts /desktop click --selector '{"byRole": "AXButton"}' --phrase "CONFIRM"
```

**完整 API 文档**: [Contract](./contract.md)

---

## 能力概览

| 能力 | 说明 |
|------|------|
| **Observe** | 截图 + AX 树，落盘证据 |
| **Find** | 按角色/标题/值查找 UI 元素 |
| **Click** | 点击 UI 元素（需 confirm token） |
| **TypeText** | 输入文本（需 confirm token） |
| **Hotkey** | 发送快捷键（需 confirm token） |
| **WaitUntil** | 等待 UI 条件成立 |
| **Abort** | 中止正在执行的请求 |
| **Confirm** | 签发一次性确认令牌 |

---

## API 参考

- **[Contract](./contract.md)** - JSON-RPC 2.0 契约（API 真相源）
- **[Recipes](../../recipes/desktop/)** - 自动化流程示例
- **[Security](../../SECURITY.md)** - 安全模型与威胁假设

---

## 开发指南

### 核心概念

- **[Event Stream](./event-stream.md)** - events.ndjson 格式规范
- **[RunTree Index](./runtree.md)** - 执行历史索引与回溯
- **[Recipe DSL](./recipe-dsl.md)** - Recipe 规范（v0）

### Menubar 配置

**配置来源优先级**（从高到低）：
1. `<WORKSPACE>/.msgcode/config.json`（项目级，推荐）
2. `~/.config/msgcode/config.json`（用户级）
3. 内置默认值

**配置字段**：

```jsonc
{
  // Menubar 三键开关
  "desktop.menubar.enabled": true,

  // Menubar 内部调用时使用的 workspace（用于证据落盘）
  "desktop.menubar.workspacePath": "/abs/workspace/path",

  // 三键快捷键（菜单 item 快捷键）
  "desktop.menubar.shortcuts.doctor": "cmd+d",
  "desktop.menubar.shortcuts.observe": "cmd+o",
  "desktop.menubar.shortcuts.openEvidence": "cmd+e",

  // "打开证据"策略
  "desktop.menubar.openEvidence.mode": "latest"  // latest | choose
}
```

**配置示例**：

**示例 1：默认配置**
```jsonc
{
  "desktop.menubar.enabled": true,
  "desktop.menubar.workspacePath": ".",
  "desktop.menubar.shortcuts.doctor": "cmd+d",
  "desktop.menubar.shortcuts.observe": "cmd+o",
  "desktop.menubar.shortcuts.openEvidence": "cmd+e",
  "desktop.menubar.openEvidence.mode": "latest"
}
```

**示例 2：禁用 Menubar**
```jsonc
{
  "desktop.menubar.enabled": false
}
```

**示例 3：自定义快捷键 + workspace**
```jsonc
{
  "desktop.menubar.enabled": true,
  "desktop.menubar.workspacePath": "/Users/myname/projects/myapp",
  "desktop.menubar.shortcuts.doctor": "cmd+shift+d",
  "desktop.menubar.shortcuts.observe": "cmd+shift+o",
  "desktop.menubar.shortcuts.openEvidence": "cmd+shift+e",
  "desktop.menubar.openEvidence.mode": "choose"
}
```

**生效方式**：
- 修改配置后，需点击 Menubar 中的 `Reload Config` 重新加载
- 或重启 MsgcodeDesktopHost.app

### Menubar 调用边界

**Internal vs External 调用**：
- **Menubar 内部调用**（`peer == nil`）：跳过 allowlist 验证，信任自己
- **外部调用**（`peer != nil`）：必须通过 allowlist 白名单验证

**事件边界**：
- Menubar 自身不产生 `menubar.*` 事件
- Menubar 调用的 `desktop.*` 方法会生成对应的 `desktop.start/stop/error` 事件
- **最小事件集**：只有 `desktop.start/stop/error` 是必需的，保持事件流简洁

**安全边界**：
- Menubar 不新增绕过确认的副作用路径
- click/typeText/hotkey 仍必须 confirm token（Menubar 调用也不例外）
- workspacePath 必须遵守"证据落盘在 workspace 内"的校验规则

### 内部规划（不随开源导出）

仓库内存在 `AIDOCS/`（内部规划、验收记录、过程资产），默认不随开源导出/打包。

---

## 安全与权限

详见 [SECURITY.md](../../SECURITY.md)

- **必需权限**: Accessibility（辅助功能）、Screen Recording（屏幕录制）
- **安全约束**: Allowlist 白名单、Confirm Token 一次性确认、Evidence 证据落盘、Abort 中止能力

---

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
# 进入 MsgcodeDesktopHost 目录
cd mac/MsgcodeDesktopHost

# 安装 LaunchAgent（生产模式 - 测试钩子禁用）
./register_launchagent.sh install

# 安装 LaunchAgent（测试模式 - 启用测试钩子）
./register_launchagent.sh install --test

# 查看 LaunchAgent 状态
./register_launchagent.sh status

# 卸载 LaunchAgent
./register_launchagent.sh uninstall
```

**切换模式**：测试模式 → 生产模式
```bash
./register_launchagent.sh uninstall
./register_launchagent.sh install
```

### 直接启动方式（不推荐用于测试）

```bash
# 直接启动（生产模式 - 测试钩子禁用）
open mac/MsgcodeDesktopHost/MsgcodeDesktopHost.app

# 通过可执行文件启动（可继承 shell 环境，仅用于调试）
export OPENCLAW_DESKTOP_TEST_HOOKS=1
mac/MsgcodeDesktopHost/MsgcodeDesktopHost.app/Contents/MacOS/MsgcodeDesktopHost
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
- 测试脚本应使用 helper 方法（如 `callTestHook`）统一注入 `_testMode` 参数
- 构建脚本应确保该环境变量不会带入发布环境

### 示例

```typescript
// 测试脚本中使用 callTestHook 包装方法
const result = await session.callTestHook("desktop._test.injectModalDetector", {
  mockModals: [{ role: "AXDialog", pid: 1234 }]
});
```

---