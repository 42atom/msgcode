# Desktop Bridge Contract（v2.2）

> 一句话：`msgcode`（daemon/CLI）通过 XPC 调用 `msgcode-desktop-host.app`，由 Host 持有 macOS TCC 权限并执行桌面原语；所有副作用动作必须显式确认，所有结果必须落盘证据到 workspace。

---

## 0) 角色与边界

- **Host（执行端）**：`msgcode-desktop-host.app`（menubar）
  - 持有权限：Accessibility + Screen Recording
  - 暴露 XPC Service：`com.msgcode.desktop.bridge`
  - 只做：observe/find/action 原语 + 证据输出
- **Client（编排端）**：`msgcode`（daemon/CLI）
  - 负责：策略、确认、lane 串行化、回发、审计索引
  - 不直接触碰：AX/截图/TCC

安全哲学（P0）：
- Host 不是"智能体"，是"受控执行器"
- 任何 `ui-control`（点击/输入/快捷键）必须带确认信息，否则拒绝

---

## 1) 传输层（XPC）

- **协议**：JSON-RPC 2.0 over XPC
- **Service 名称**：`com.msgcode.desktop.bridge`
- **编码**：UTF-8
- **传输**：XPC messaging（单次请求-响应，非流式）

### 1.1 XPC Service 定义

Host 暴露的 XPC Service：
```objc
// Service: com.msgcode.desktop.bridge
// Protocol: JSON-RPC 2.0
// Connection: listener mode（Host 监听，Client 连接）
```

Client 通过 XPC 连接规则：
- 使用 `NSXPCConnection` 连接到 service name
- 配置 `NSXPCInterface` 暴露 `sendMessage:` 方法
- 消息格式：JSON string（request），返回 JSON string（response）

### 1.2 消息格式

- **Request**：JSON string → Host
- **Response**：JSON string → Client
- **帧**：单次 XPC message（非 NDJSON；XPC 本身提供消息边界）

---

## 2) 证据（Evidence）落盘约定

原则：证据必须落在 workspace 内（方便复制/归档/审计），Host 只写"允许目录"。

### 2.1 允许目录（P0）

- Host 启动时读取 `WORKSPACE_ROOT`
- 每次请求的 `meta.workspacePath` 必须满足：`realpath(workspacePath)` 以 `realpath(WORKSPACE_ROOT)` 为前缀
- 否则返回错误码 `DESKTOP_WORKSPACE_FORBIDDEN`

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
  "requestId": "uuid",
  "workspacePath": "/abs/path/to/workspace",
  "timeoutMs": 60000
}
```

### 4.2 Confirm（副作用方法必带）

**T8.6 校验规则（优先级：token > phrase）：**
- 若提供 `confirm.token`：
  - 校验 peer 绑定（auditTokenDigest/pid）
  - 校验 scope 绑定（method + paramsDigest）
  - 校验 TTL（默认 60s）
  - 校验 single-use（消费后失效）
  - 任意失败返回 `DESKTOP_CONFIRM_REQUIRED`
- 否则回退 `confirm.phrase`（兼容 T8）：
  - 必须等于 `"CONFIRM"` 或 `"CONFIRM:<requestId>"`
  - 否则返回错误码 `DESKTOP_CONFIRM_REQUIRED`

```jsonc
{
  "token": "uuid-v4",                    // T8.6：优先级高于 phrase（一次性 token）
  "phrase": "CONFIRM:uuid",              // 兼容 T8：token 缺失时使用
  "approvedAt": "2026-02-09T12:00:00Z",  // 可选，审批时间
  "approver": "user"                     // 可选，审批人标识
}
```

**需要 confirm 的方法：**
- `desktop.click`（ui-control）
- `desktop.typeText`（ui-control）
- `desktop.hotkey`（ui-control）

**不需要 confirm 的方法：**
- `desktop.find`（read-only）
- `desktop.waitUntil`（read-only）
- `desktop.abort`（process-control）

### 4.3 Route（目标上下文）
```jsonc
{
  "app": { "bundleId": "com.apple.Safari" },
  "window": { "titlePattern": ".*Safari.*" },
  "focusPolicy": "focusIfNeeded"
}
```

### 4.4 Selector（元素定位，P0 先做常用子集）

**T8 P0 支持字段（最小集）：**
```jsonc
{
  "byRole": "AXButton",          // 精确匹配 AXRole
  "titleContains": "Send",       // 包含匹配 AXTitle
  "valueContains": "hello",      // 包含匹配 AXValue
  "limit": 5                     // 最多返回 N 个候选（默认 10）
}
```

**搜索范围（T8）：**
- 从 `frontmost` app root 开始（T7.A4 已建立）
- 不做跨应用搜索（P0）

### 4.5 ElementRef（Host 生成的短期引用）

**T8 P0 字段（最小集）：**
```jsonc
{
  "elementId": "e:123",                    // Host 内部唯一 ID
  "fingerprint": "AXButton|Send|x=12,y=34,w=56,h=20",  // role+title+frame 的 hash/拼接
  "role": "AXButton",                      // AXRole
  "title": "Send",                         // AXTitle（若存在）
  "value": "hello",                        // AXValue（若存在）
  "frame": {                               // 屏幕坐标（T8 新增）
    "x": 12,
    "y": 34,
    "width": 56,
    "height": 20
  }
}
```

**fingerprint 用途（T9 预留）：**
- stale 检测：elementRef 失效后可重新匹配
- 候选评分：多个命中时按相似度排序

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
  "bridge": { "schemaVersion": 1 },
  "peer": {
    "pid": 12345,
    "auditTokenDigest": "01234567"
  }
}
```

---

### 5.2 `desktop.doctor`（read-only）

用途：详细诊断权限状态和 peer 信息（session 自愈验证）。

请求：
```jsonc
{ "meta": { ... } }
```

返回：
```jsonc
{
  "permissions": {
    "accessibility": {
      "granted": true,
      "required": true,
      "purpose": "AX observe/find/action"
    },
    "screenRecording": {
      "granted": true,
      "required": true,
      "purpose": "Screenshot capture"
    }
  },
  "issues": ["Accessibility permission denied"],
  "healthy": false,
  "peer": {
    "pid": 12345,
    "auditTokenDigest": "01234567"
  }
}
```

---

### 5.3 `desktop.observe`（read-only）

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

### 5.4 `desktop.find`（read-only）

用途：在目标 route 下查找元素（不执行点击），输出候选 elementRefs。

**T8 P0 请求：**
```jsonc
{
  "meta": { ... },
  "route": { ... },              // 可选，默认 frontmost app
  "selector": {
    "byRole": "AXButton",        // 可选，精确匹配
    "titleContains": "Send",     // 可选，包含匹配
    "valueContains": "hello",    // 可选，包含匹配
    "limit": 5                   // 可选，最多返回 N 个（默认 10）
  }
}
```

**T8 P0 返回：**
```jsonc
{
  "executionId": "uuid",
  "elementRefs": [               // T8：改名为 elementRefs（复数）
    {
      "elementId": "e:123",
      "fingerprint": "AXButton|Send|x=12,y=34,w=56,h=20",
      "role": "AXButton",
      "title": "Send",
      "value": null,
      "frame": { "x": 12, "y": 34, "width": 56, "height": 20 }
    }
  ],
  "matched": 1,                  // 命中数量
  "evidence": {
    "dir": "<WORKSPACE>/artifacts/desktop/2026-02-09/<executionId>/",
    "axPath": "ax.json"
  }
}
```

**搜索范围（T8）：**
- 从 `frontmost` app root 开始（T7.A4 已建立）
- 遍历所有子元素，按 selector 过滤
- 不做跨应用搜索（P0）

---

### 5.5 `desktop.click`（ui-control）

用途：点击一个 selector 或 elementRef。

**T8 P0 请求（target 二选一）：**
```jsonc
{
  "meta": { ... },
  "confirm": {
    "phrase": "CONFIRM:uuid"     // 必填，否则返回 DESKTOP_CONFIRM_REQUIRED
  },
  "route": { ... },              // 可选，默认 frontmost app
  "target": {
    "elementRef": {              // 方式1：直接引用 find 返回的 elementRef
      "elementId": "e:123",
      "fingerprint": "AXButton|Send|x=12,y=34,w=56,h=20"
    }
    // 或
    "selector": { ... }          // 方式2：复用 find 的 selector
  }
}
```

**T8 P0 返回：**
```jsonc
{
  "executionId": "uuid",
  "clicked": true,               // 点击成功
  "evidence": {
    "dir": "<WORKSPACE>/artifacts/desktop/2026-02-09/<executionId>/",
    "beforeScreenshot": "before.png",   // T9 预留
    "afterScreenshot": "after.png"     // T9 预留
  }
}
```

**执行动作（T8）：**
- 优先使用 `AXPress`（若元素的 AXActions 包含 kAXPressAction）
- 若无 action：返回 `DESKTOP_ELEMENT_NOT_FOUND` 或 `DESKTOP_INTERNAL_ERROR`

**错误处理：**
- `DESKTOP_CONFIRM_REQUIRED`：缺少 confirm 或 phrase 不匹配
- `DESKTOP_ELEMENT_NOT_FOUND`：target 未命中
- `DESKTOP_INTERNAL_ERROR`：AX API 调用失败（含 message）

---

### 5.6 `desktop.typeText`（ui-control）

用途：输入文本（可选先聚焦某个输入框）。

**T8 P0 请求：**
```jsonc
{
  "meta": { ... },
  "confirm": {
    "phrase": "CONFIRM:uuid"     // 必填
  },
  "route": { ... },              // 可选，默认 frontmost app
  "target": {
    "elementRef": { ... },       // 可选，若提供则先尝试 AXFocused
    "selector": { ... }          // 可选，fallback 到 selector
  },
  "text": "hello world",         // 必填，要输入的文本
  "options": {
    "clearBefore": false         // 可选，是否先清空（P0 暂不实现）
  }
}
```

**T8 P0 返回：**
```jsonc
{
  "executionId": "uuid",
  "typed": true,
  "evidence": {
    "dir": "<WORKSPACE>/artifacts/desktop/2026-02-09/<executionId>/"
  }
}
```

**输入方式（T8）：**
- **剪贴板粘贴路径（P0 稳定方案）**：
  1. 写入剪贴板
  2. 调用 `desktop.hotkey` 发送 `⌘V`
- **目标聚焦**：
  - 若提供 `elementRef`：先尝试 `AXFocused = true`
  - 若失败：跳过聚焦，直接粘贴

**错误处理：**
- `DESKTOP_CONFIRM_REQUIRED`：缺少 confirm
- `DESKTOP_ELEMENT_NOT_FOUND`：target 未命中且无法聚焦

---

### 5.7 `desktop.hotkey`（ui-control）

用途：发送快捷键组合。

**T8 P0 请求：**
```jsonc
{
  "meta": { ... },
  "confirm": {
    "phrase": "CONFIRM:uuid"     // 必填
  },
  "route": { ... },              // 可选，默认 frontmost app
  "keys": ["cmd", "v"],          // 必填，组合键（数组）
  "options": {
    "delayMs": 50                // 可选，按键间隔（T9 预留）
  }
}
```

**T8 P0 返回：**
```jsonc
{
  "executionId": "uuid",
  "sent": true,
  "evidence": {
    "dir": "<WORKSPACE>/artifacts/desktop/2026-02-09/<executionId>/"
  }
}
```

**支持组合（T8 P0 最小集）：**
- `["cmd", "v"]`：粘贴（⌘V）
- `["enter"]`：回车
- `["cmd", "enter"]`：发送（可选，T9 扩展更多组合）

**键名映射（CGEventKeyCode）：**
- `cmd`：`kVK_Command`
- `v`：`kVK_ANSI_V`
- `enter`：`kVK_Return`
- 更多组合 T9 扩展

---

### 5.8 `desktop.waitUntil`（read-only）

用途：等待某个 UI 条件成立（带硬超时）。

**T8 P0 请求：**
```jsonc
{
  "meta": { ... },
  "route": { ... },              // 可选，默认 frontmost app
  "condition": {
    "selectorExists": {          // T8：只支持 selectorExists 条件
      "byRole": "AXButton",
      "titleContains": "Send"
    }
  },
  "pollMs": 500,                 // 可选，轮询间隔（默认 500ms）
  "timeoutMs": 15000             // 必填，硬超时
}
```

**T8 P0 返回：**
```jsonc
{
  "executionId": "uuid",
  "ok": true,                    // 条件成立
  "matched": 1,                  // 命中数量
  "elapsedMs": 1234,             // 实际等待时间
  "evidence": {
    "dir": "<WORKSPACE>/artifacts/desktop/2026-02-09/<executionId>/",
    "axPath": "ax.json"
  }
}
```

**执行逻辑（T8）：**
- 轮询 `desktop.find`，直到命中（`elementRefs.length > 0`）或超时
- 超时返回错误码 `DESKTOP_TIMEOUT`。

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

### 5.9 `desktop.abort`（process-control）

用途：中断当前等待/执行链路（single-flight）。

**T8 P0 请求：**
```jsonc
{
  "meta": { ... },
  "executionId": "uuid"          // 必填，要中止的请求 ID
}
```

**T8 P0 返回：**
```jsonc
{
  "aborted": true,
  "executionId": "uuid"
}
```

**执行效果（T8）：**
- 让当前 `executionId` 的请求尽快返回 `DESKTOP_ABORTED`
- 后续动作不再执行（至少保证"不会继续注入键鼠"）
- 若请求已结束：返回 `DESKTOP_INVALID_REQUEST`

---

### 5.10 `desktop.confirm.issue`（T8.6：token 签发）

用途：为即将执行的 ui-control 动作签发一次性确认令牌。

**T8.6 请求：**
```jsonc
{
  "meta": { ... },
  "intent": {
    "method": "desktop.typeText",      // 必填，目标方法
    "params": {                        // 必填，目标参数（用于计算 paramsDigest）
      "target": { "selector": { ... } },
      "text": "hello world"
    }
  },
  "ttlMs": 60000                       // 可选，token 有效期（默认 60000ms）
}
```

**T8.6 返回：**
```jsonc
{
  "token": "uuid-v4",                  // 一次性确认令牌
  "expiresAt": "2026-02-09T12:01:00Z", // ISO 8601 过期时间
  "scope": {
    "method": "desktop.typeText",      // 绑定的方法
    "paramsDigest": "a1b2c3d4"         // 参数指纹（SHA256 前 16 hex）
  },
  "peer": {
    "auditTokenDigest": "xyz",         // 绑定的 peer（进程标识）
    "pid": 12345                       // 客户端进程 ID
  }
}
```

**签发规则（T8.6）：**
- `token`：随机 UUID v4
- `paramsDigest`：canonical JSON（key 排序）+ SHA256 前 16 字符
- `ttlMs`：默认 60000ms（60s）
- peer 绑定：从 XPC connection 提取 `auditToken`/`pid`

**使用流程：**
1. Client 调用 `desktop.confirm.issue` 获取 token
2. Client 调用 ui-control 方法时传入 `confirm.token`
3. Bridge 校验：peer/method/paramsDigest/TTL/used
4. 校验通过后 consume token（标记 used + 删除）
5. 第二次使用相同 token 返回 `DESKTOP_CONFIRM_REQUIRED`

---

## 6) 错误码（P0 必要子集）

- `DESKTOP_HOST_NOT_READY`：Host 未就绪（初始化/权限检查中）
- `DESKTOP_PERMISSION_MISSING`：缺 Accessibility/Screen Recording
- `DESKTOP_WORKSPACE_FORBIDDEN`：workspacePath 不在 WORKSPACE_ROOT 下
- `DESKTOP_CONFIRM_REQUIRED`：缺 confirm（ui-control 方法）
- `DESKTOP_ELEMENT_NOT_FOUND`：selector 未命中
- `DESKTOP_TIMEOUT`：wait/observe 超时
- `DESKTOP_ABORTED`：被 abort 中止
- `DESKTOP_INTERNAL_ERROR`：未知错误
- `DESKTOP_INVALID_REQUEST`：请求格式错误/参数缺失

---

## 7) 版本策略

- `meta.schemaVersion`：Bridge schema 版本（P0=1）
- **不做兼容承诺**：2.2 期间允许快速演进；变更以文档为准
- 若破坏性变更：提升 `schemaVersion`，并在 `desktop.health` 返回中体现

---

