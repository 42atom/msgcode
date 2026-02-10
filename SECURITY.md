# Security Policy

## 概述

msgcode Desktop Bridge 提供 macOS 本地 UI 自动化能力（截图/AX树/点击/输入/快捷键）。由于涉及屏幕录制、辅助功能、UI 交互等敏感权限，本文档描述安全模型和威胁假设。

---

## 权限要求

### 必需权限

| 权限 | 用途 | 风险 |
|------|------|------|
| **Accessibility（辅助功能）** | AX 树观察、元素查找、UI 交互 | 可读取屏幕内容和 UI 结构 |
| **Screen Recording（屏幕录制）** | 截图功能 | 可捕获屏幕内容 |

### 权限检查

- Bridge 启动时自动检查权限状态
- `desktop.health` / `desktop.doctor` 返回权限状态
- 权限缺失时操作失败，返回 `DESKTOP_PERMISSION_MISSING`

### 权限边界

**推荐配置**：
- 开发环境：授予 Accessibility + Screen Recording
- 生产环境：考虑沙箱隔离（如单独用户空间）

**不可逆操作建议**：
- Click/TypeText/Hotkey 等副作用操作建议 **human-in-the-loop**（通过 Confirm Token 机制）
- Observe/Find 等只读操作可自动执行

---

## 安全约束

### 1. Allowlist 白名单（T5.1）

**目的**：限制哪些调用者可以使用 Desktop Bridge

**默认行为**：
- allowlist 文件不存在 → 允许所有（兼容性）
- allowlist 空数组 → 拒绝所有
- allowlist 包含 `*` → 允许所有
- allowlist 包含 `pid:12345` → 仅允许指定进程

**配置位置**：`<workspace>/allowlist.json`

**示例**：
```json
{
  "callers": ["*"]
}
```

```json
{
  "callers": ["pid:12345", "pid:67890"]
}
```

### 2. Confirm Token 一次性确认（T8.6）

**目的**：副作用操作（Click/TypeText/Hotkey）需要显式确认

**流程**：
1. 调用者先调用 `desktop.confirm.issue` 获取 token
2. Token 绑定调用者身份（peer.pid + auditTokenDigest）
3. Token 绑定操作参数（method + paramsDigest）
4. Token 单次有效，使用后即销毁

**示例**：
```json
// 1. 签发 token
{
  "method": "desktop.confirm.issue",
  "params": {
    "intent": {
      "method": "desktop.click",
      "params": {
        "selector": {"byRole": "AXButton"}
      }
    }
  }
}
// → {"token": "uuid", "expiresAt": "..."}

// 2. 使用 token
{
  "method": "desktop.click",
  "params": {
    "confirm": {"token": "uuid"}
  }
}
// → 成功执行
```

### 3. Evidence 证据落盘（T10）

**目的**：所有操作都留下可审计的证据

**证据内容**：
- `screenshot.png`: 操作前截图
- `ax.json`: AX 树快照
- `events.ndjson`: 事件流（start/stop/observe）
- `env.json`: 环境信息（peer、host、timestamp）

**落盘位置**：`<workspace>/artifacts/desktop/<date>/<executionId>/`

**不可篡改**：events.ndjson 使用 append-only 写入，防止事后修改

### 4. Abort 中止能力（T8.3）

**目的**：允许主动中止正在执行的操作

**使用场景**：检测到异常行为时立即停止

**API**：`desktop.abort`

---

## 威胁假设

### 关键威胁

| 威胁 | 描述 | 缓解措施 |
|------|------|---------|
| 未授权调用 | 恶意第三方调用 Desktop Bridge | Allowlist 白名单 |
| 恶意操作 | 未授权的点击/输入/快捷键 | Confirm Token 一次性确认 |
| 无痕攻击 | 删除证据文件逃避审计 | Evidence 强制落盘 + append-only |
| 异常执行 | 操作卡死或执行异常逻辑 | Abort 主动中止 |

### 攻击面

- **本地 IPC**（XPC）：进程间通信，暴露给本地进程
- **权限滥用**：Accessibility 可读取敏感信息，Screen Recording 可截屏
- **UI 注入**：Click/TypeText/Hotkey 可模拟用户操作

---

## 安全最佳实践

### 1. 最小权限原则

- 仅授予必要的 Accessibility 和 Screen Recording 权限
- 生产环境建议配置 allowlist，限制调用者

### 2. 白名单优先

```json
// 推荐配置：仅允许特定进程
{
  "callers": ["pid:12345", "pid:67890"]
}
```

### 3. 定期审计

- 检查 `artifacts/desktop/` 证据目录
- 关注 `events.ndjson` 中的异常操作
- 监控 allowlist 配置变更

### 4. Human-in-the-Loop

- Click/TypeText/Hotkey 等副作用操作建议人工确认
- 使用 Confirm Token 机制强制显式批准

### 5. 隔离运行

- 考虑在沙箱环境或专用用户空间运行
- 限制 Bridge Host 的网络访问（默认无网络代码）

---

## 漏洞报告

### 报告入口

1. **GitHub Issues**: [提交 Issue](https://github.com/your-org/msgcode/issues)
2. **私有渠道**（敏感漏洞）：通过项目维护者私信/邮件报告

### 报告内容

请包含以下信息：

- 漏洞类型
- 影响范围
- 复现步骤
- 建议缓解措施

### 响应 SLA

| 严重程度 | 响应时间 | 修复时限 |
|---------|---------|---------|
| 严重（Critical） | 48 小时 | 7 天 |
| 高（High） | 7 天 | 30 天 |
| 中（Medium） | 14 天 | 90 天 |
| 低（Low） | 30 天 | 下个版本 |

### 支持版本范围

当前维护版本：msgcode v2.2.x

**安全更新**：仅当前维护版本接收安全更新，历史版本不再维护。

---

## 附录：MITRE ATT&CK 映射

| ATT&CK 技术 | Desktop Bridge 能力 | 缓解措施 |
|-------------|---------------------|---------|
| T1059.001 | TypeText, Hotkey | Confirm Token + Allowlist |
| T1013 | Observe, Find | Evidence 落盘 + Abort |
| T1204 | Click | Confirm Token + Allowlist |
| T1123 | Screenshot | Evidence 落盘（screenshot.png） |

**参考**: [MITRE ATT&CK Framework](https://attack.mitre.org/techniques/enterprise/)

---

*更新: 2026-02-10*
