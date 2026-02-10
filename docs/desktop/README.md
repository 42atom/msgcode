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

### 内部规划（不随开源导出）

仓库内存在 `AIDOCS/`（内部规划、验收记录、过程资产），默认不随开源导出/打包。

---

## 安全与权限

详见 [SECURITY.md](../../SECURITY.md)

- **必需权限**: Accessibility（辅助功能）、Screen Recording（屏幕录制）
- **安全约束**: Allowlist 白名单、Confirm Token 一次性确认、Evidence 证据落盘、Abort 中止能力
