# Desktop Bridge Contract（v2.2）

> 一句话：`msgcode`（daemon/CLI）通过本地 Bridge 调用 `msgcode-desktop-host.app`，由 Host 持有 macOS TCC 权限并执行桌面原语；所有副作用动作必须显式确认，所有结果必须落盘证据。

---

## 0) 角色与边界

- **Host（执行端）**：`msgcode-desktop-host.app`（menubar）
  - 持有权限：Accessibility + Screen Recording
  - 暴露 Bridge：Unix Domain Socket + JSON-RPC
  - 只做：observe/find/action 原语 + 证据输出
- **Client（编排端）**：`msgcode`（daemon/CLI）
  - 负责：策略、确认、lane 串行化、回发、审计索引
  - 不直接触碰：AX/截图/TCC

安全哲学（P0）：
- Host 不是“智能体”，是“受控执行器”
- 任何 `ui-control`（点击/输入/快捷键）必须带确认信息，否则拒绝

---

## 1) 传输层

- **协议**：JSON-RPC 2.0
- **载体**：Unix Domain Socket（本机）
- **编码**：UTF-8
- **帧**：NDJSON（每条请求/响应一行 JSON；以 `\n` 分隔）

建议路径（P0）：
```
~/.config/msgcode/desktop/bridge.sock
~/.config/msgcode/desktop/bridge.token
```

Client 连接规则：
- socket 文件权限必须为 `0600`
- Client 每次请求必须携带 `authToken`（读取 `bridge.token`）

---

## 2) 证据（Evidence）落盘约定

原则：证据必须落在 workspace 内（方便复制/归档/审计），Host 只写“允许目录”。

### 2.1 允许目录（P0）

- Host 启动时读取 `WORKSPACE_ROOT`
- 每次请求的 `workspacePath` 必须满足：`realpath(workspacePath)` 以 `realpath(WORKSPACE_ROOT)` 为前缀
- 否则返回 `DESKTOP_WORKSPACE_FORBIDDEN`

### 2.2 目录结构（P0）

```
<WORKSPACE>/
└── artifacts/
    └── desktop/
        └── YYYY-MM-DD/
            └── <executionId>/
                ├── observe.png          # 截图（如有）
                ├── ax.json              # AX 树/摘要（如有）
                ├── trace.jsonl          # Host 侧执行日志（可选）
                └── result.json          # 结构化结果（可选）
```

---

## 3) JSON-RPC 消息格式

### 3.1 Request

```jsonc
{
  "jsonrpc": "2.0",
  "id": "uuid",
  "method": "desktop.observe",
  "params": {
    "meta": {
      "schemaVersion": 1,
      "authToken": "secret",
      "requestId": "uuid",
      "workspacePath": "/abs/path/to/workspace",
      "timeoutMs": 60000
    },
    "...": "method-specific"
  }
}
```

### 3.2 Response（success）
```jsonc
{
  "jsonrpc": "2.0",
  "id": "uuid",
  "result": { "...": "method-specific" }
}
```

### 3.3 Response（error）
```jsonc
{
  "jsonrpc": "2.0",
  "id": "uuid",
  "error": {
    "code": "DESKTOP_TIMEOUT",
    "message": "等待超时",
    "retryable": true,
    "details": { "timeoutMs": 60000 }
  }
}
```

---

## 4) 通用类型（P0 最小）

### 4.1 Meta（所有方法必带）
```jsonc
{
  "schemaVersion": 1,
  "authToken": "secret",
  "requestId": "uuid",
  "workspacePath": "/abs/path/to/workspace",
  "timeoutMs": 60000
}
```

### 4.2 Confirm（副作用方法必带）

```jsonc
{
  "approved": true,
  "approvalId": "uuid",
  "approvedAtMs": 0
}
```

缺失则返回：`DESKTOP_CONFIRM_REQUIRED`

### 4.3 Route（目标上下文）
```jsonc
{
  "app": { "bundleId": "com.apple.Safari" },
  "window": { "titlePattern": ".*Safari.*" },
  "focusPolicy": "focusIfNeeded"
}
```

### 4.4 Selector（元素定位，P0 先做常用子集）
```jsonc
{
  "byRole": "AXButton",
  "byLabel": { "contains": "Send" }
}
```

### 4.5 ElementRef（Host 生成的短期引用）
```jsonc
{
  "elementId": "e:123",
  "fingerprint": "AXButton|Send|x=12,y=34,w=56,h=20",
  "role": "AXButton",
  "label": "Send",
  "rect": { "x": 12, "y": 34, "w": 56, "h": 20 }
}
```

---

## 5) 方法（Methods）

### 5.1 `desktop.health`（read-only）

请求：
```jsonc
{ "meta": { ... } }
```

返回：
```jsonc
{
  "hostVersion": "0.1.0",
  "macos": "14.x",
  "permissions": {
    "accessibility": "granted",
    "screenRecording": "granted"
  },
  "bridge": { "schemaVersion": 1 }
}
```

---

### 5.2 `desktop.observe`（read-only）

用途：截图 + AX 摘要/树（有界遍历），并写入 evidence。

请求：
```jsonc
{
  "meta": { ... },
  "route": { ... },
  "options": {
    "includeScreenshot": true,
    "includeAxTree": true,
    "axMaxDepth": 8,
    "axMaxNodes": 2000
  }
}
```

返回：
```jsonc
{
  "executionId": "uuid",
  "routeResolved": {
    "frontmostBundleId": "com.apple.Safari",
    "windowTitle": "..."
  },
  "evidence": {
    "dir": "<WORKSPACE>/artifacts/desktop/2026-02-03/<executionId>/",
    "screenshotPath": "observe.png",
    "axPath": "ax.json"
  }
}
```

---

### 5.3 `desktop.find`（read-only）

用途：在目标 route 下查找元素（不执行点击），输出候选 elementRefs。

请求：
```jsonc
{
  "meta": { ... },
  "route": { ... },
  "selector": { ... },
  "limit": 5
}
```

返回：
```jsonc
{
  "executionId": "uuid",
  "candidates": [
    { "score": 0.92, "element": { ...ElementRef } }
  ],
  "evidence": { "dir": "...", "axPath": "ax.json" }
}
```

---

### 5.4 `desktop.click`（ui-control）

用途：点击一个 selector 或 elementRef。

请求（任选其一）：
```jsonc
{
  "meta": { ... },
  "confirm": { ... },
  "route": { ... },
  "selector": { ... }
}
```

或：
```jsonc
{
  "meta": { ... },
  "confirm": { ... },
  "route": { ... },
  "element": { ...ElementRef }
}
```

返回：
```jsonc
{
  "executionId": "uuid",
  "clicked": true,
  "evidence": { "dir": "..." }
}
```

---

### 5.5 `desktop.typeText`（ui-control）

用途：输入文本（可选先聚焦某个输入框）。

请求：
```jsonc
{
  "meta": { ... },
  "confirm": { ... },
  "route": { ... },
  "target": { "selector": { ... } },
  "text": "hello",
  "options": { "clearBefore": false }
}
```

返回：
```jsonc
{ "executionId": "uuid", "typed": true, "evidence": { "dir": "..." } }
```

---

### 5.6 `desktop.hotkey`（ui-control）

请求：
```jsonc
{
  "meta": { ... },
  "confirm": { ... },
  "route": { ... },
  "keys": ["cmd", "l"]
}
```

返回：
```jsonc
{ "executionId": "uuid", "sent": true, "evidence": { "dir": "..." } }
```

---

### 5.7 `desktop.waitUntil`（read-only）

用途：等待某个 UI 条件成立（带硬超时）。

请求：
```jsonc
{
  "meta": { ... },
  "route": { ... },
  "condition": { "selectorExists": { ... } },
  "pollMs": 500,
  "timeoutMs": 15000
}
```

返回：
```jsonc
{
  "executionId": "uuid",
  "ok": true,
  "evidence": { "dir": "...", "axPath": "ax.json" }
}
```

---

### 5.8 `desktop.abort`（process-control）

用途：中断当前等待/执行链路（single-flight）。

请求：
```jsonc
{ "meta": { ... }, "executionId": "uuid" }
```

返回：
```jsonc
{ "aborted": true }
```

---

## 6) 错误码（P0 必要子集）

- `DESKTOP_AUTH_FAILED`：authToken 不匹配
- `DESKTOP_HOST_NOT_READY`：Host 未就绪（初始化/权限检查中）
- `DESKTOP_PERMISSION_MISSING`：缺 Accessibility/Screen Recording
- `DESKTOP_WORKSPACE_FORBIDDEN`：workspacePath 不在 WORKSPACE_ROOT 下
- `DESKTOP_CONFIRM_REQUIRED`：缺 confirm（ui-control 方法）
- `DESKTOP_ELEMENT_NOT_FOUND`：selector 未命中
- `DESKTOP_TIMEOUT`：wait/observe 超时
- `DESKTOP_ABORTED`：被 abort 中止
- `DESKTOP_INTERNAL_ERROR`：未知错误

---

## 7) 版本策略

- `meta.schemaVersion`：Bridge schema 版本（P0=1）
- **不做兼容承诺**：2.2 期间允许快速演进；变更以文档为准
- 若破坏性变更：提升 `schemaVersion`，并在 `desktop.health` 返回中体现

---

## 8) P1 预留（不做，但不反对）

- XPC（替代 UDS）+ TeamID allowlist（更强身份校验）
- Stream（observe 连续帧/长任务进度事件）
- ActionChain（一次 RPC 带多步 plan，Host 内 single-flight 执行）
- 证据签名/receipt（供应链与审计强化）

