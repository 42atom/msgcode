# msgcode Desktop Host (macOS)

Msgcode Desktop Host 是一个 macOS menubar 应用程序，作为 msgcode daemon/CLI 的桌面自动化执行端。

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                     msgcode (Client)                             │
│  - daemon/CLI 进程                                               │
│  - 负责：策略、确认、lane 串行化、回发、审计索引                   │
│  - 不直接触碰：AX/截图/TCC                                        │
└─────────────────────────────────────┬───────────────────────────┘
                                      │ XPC (Mach service)
                                      │ com.msgcode.desktop.bridge
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│        MsgcodeDesktopHost.app (Menubar + Bridge Server)         │
│  - 权限宿主：Accessibility + Screen Recording                    │
│  - 协议：JSON-RPC 2.0 (sendMessage)                              │
│  - P0 方法：health, doctor, observe                              │
│  - 证据落盘：workspace/artifacts/desktop/                        │
└─────────────────────────────────────────────────────────────────┘
```

## 项目结构

```
mac/MsgcodeDesktopHost/
├── BridgeServer.swift              # Bridge Server（内置 NSXPCListener）
├── BridgeXPC/
│   ├── BridgeXPCProtocol.swift     # XPC 协议 + JSON-RPC 工具
│   └── main.swift                  # 历史文件（已废弃）
├── HostApp/
│   ├── main.swift                  # Menubar UI + Bridge 控制
│   └── Info.plist                  # Host App 配置（LSUIElement=true）
├── build.sh                        # 构建脚本（只构建 Host）
├── register_launchagent.sh         # 注册 LaunchAgent（导出 MachServices）
├── test_client.sh                  # 测试客户端（验收用）
└── MsgcodeDesktopHost.app/         # 构建产物（无 PlugIns/.xpc）
    └── Contents/MacOS/MsgcodeDesktopHost
```

## 已实现功能（T6/T7 验收通过）

### Bridge Server (com.msgcode.desktop.bridge)

| 方法 | 状态 | 说明 |
|------|------|------|
| desktop.health | ✅ | 返回 hostVersion、macos、permissions |
| desktop.doctor | ✅ | 详细诊断权限状态（granted/required/purpose/issues） |
| desktop.observe | ✅ | 落盘 env.json/observe.png/ax.json 到 workspace/artifacts/desktop/YYYY-MM-DD/<executionId>/ |
| allowlist 验证 | ✅ | 基于 allowlist.json 的调用者白名单验证（T5） |
| peer identity | ✅ | 从 XPC connection 提取 peer 信息并写入 env.json（T5） |

### Menubar Host App（权限宿主）

| 功能 | 状态 |
|------|------|
| 权限状态监控 | ✅ Accessibility + Screen Recording |
| Start Bridge | ✅ 启动 Bridge Server |
| Stop Bridge | ✅ 停止 Bridge Server |
| Panic Stop | ✅ 紧急停止 |

## 构建和运行

### 1. 构建

```bash
cd mac/MsgcodeDesktopHost
./build.sh
```

构建脚本会：
1. 编译 Host App (MsgcodeDesktopHost)
2. 创建 .app bundle（内置 Bridge Server，不再嵌入 .xpc）

### 2. 注册 Mach service（LaunchAgent）

```bash
cd mac/MsgcodeDesktopHost
bash register_launchagent.sh install
```

验证注册：
```bash
launchctl list | grep com.msgcode.desktop.bridge
```

卸载：
```bash
bash register_launchagent.sh uninstall
```

### 3. 运行 Host App

```bash
open MsgcodeDesktopHost.app
```

或双击 `MsgcodeDesktopHost.app`

### 4. 授予权限（首次运行）

系统会提示授予以下权限（或在"系统设置 → 隐私与安全性"中手动授予）：

1. **辅助功能（Accessibility）**
   - 路径：系统设置 → 隐私与安全性 → 辅助功能
   - 用途：AX observe/find/action（观察 UI、查找元素、执行点击）

2. **屏幕录制（Screen Recording）**
   - 路径：系统设置 → 隐私与安全性 → 屏幕录制
   - 用途：截图功能

## 验收测试

### 自动化测试

```bash
cd mac/MsgcodeDesktopHost
./test_client.sh
```

预期输出：
```
测试结果: 3/3 通过
✅ desktop.health 成功
✅ desktop.doctor 成功
✅ desktop.observe 成功
✅ 证据目录存在
✅ env.json 存在
```

### 证据目录结构

```
<workspace>/artifacts/desktop/YYYY-MM-DD/<executionId>/
├── env.json           # ✅ 已实现（peer + host 信息，T5 完成）
├── observe.png        # ✅ 截图（T7）
└── ax.json            # ✅ AX 树（T7）
```

## XPC 协议

### sendMessage 入口

```swift
@objc func sendMessage(_ requestJson: String, reply: @escaping (String) -> Void)
```

### JSON-RPC 2.0 请求格式

```jsonc
{
  "jsonrpc": "2.0",
  "id": "uuid",
  "method": "desktop.health",
  "params": {
    "meta": {
      "schemaVersion": 1,
      "requestId": "uuid",
      "workspacePath": "/abs/path/to/workspace",
      "timeoutMs": 60000
    }
  }
}
```

### 错误码

| 错误码 | 说明 |
|--------|------|
| DESKTOP_HOST_NOT_READY | Host 未就绪 |
| DESKTOP_PERMISSION_MISSING | 缺少权限 |
| DESKTOP_WORKSPACE_FORBIDDEN | workspacePath 不在允许目录下 |
| DESKTOP_CONFIRM_REQUIRED | 缺少 confirm（ui-control 方法） |
| DESKTOP_ELEMENT_NOT_FOUND | selector 未命中 |
| DESKTOP_TIMEOUT | 等待超时 |
| DESKTOP_ABORTED | 被 abort 中止 |
| DESKTOP_INTERNAL_ERROR | 未知错误 |
| DESKTOP_INVALID_REQUEST | 请求格式错误 |
| DESKTOP_HOST_STOPPED | Host 已停止（Panic Stop） |
| DESKTOP_CALLER_NOT_ALLOWED | allowlist 验证失败（T5） |

## T5: Peer Identity + Allowlist ✅

### 技术债（P1，不挡上线）

**Code Signing 信息提取**
- peer.signingId: 当前为 null
- peer.teamId: 当前为 null
- 需要：使用 macOS Code Signing API (`cs`) 提取进程的签名信息
- 目的：实现可分发、可控的 allowlist（基于签名 ID 而非 PID）
- 验收：allowlist 支持 `signingId:` 和 `teamId:` 规则

### T5.0: env.json 写入 peer identity

env.json 现在包含完整的 peer 和 host 信息：

```json
{
  "executionId": "...",
  "timestamp": "2026-02-09T...",
  "workspacePath": "/path/to/workspace",
  "peer": {
    "pid": 97247,
    "auditTokenDigest": "d997edfe00f44546",
    "signingId": null,
    "teamId": null
  },
  "host": {
    "pid": 97260,
    "bundleId": "com.msgcode.desktop.bridge",
    "version": "0.1.0"
  },
  "permissions": {
    "accessibility": false,
    "screenRecording": false
  }
}
```

- **peer.pid**: XPC 连接对端的进程 ID
- **peer.auditTokenDigest**: audit token 的 SHA256 摘要（前 8 字节十六进制）
- **peer.signingId**: Code Signing Identity（待实现，目前为 null）
- **peer.teamId**: Developer Team ID（待实现，目前为 null）
- **host.pid**: XPC Service 进程 ID
- **host.bundleId**: XPC Service Bundle ID
- **host.version**: Host 版本号

### T5.1: Allowlist 验证

allowlist.json 放置在 workspace 根目录：

```json
{
  "callers": [
    "pid:12345",      // 精确 PID 匹配
    "signingId:...",  // Signing ID 匹配（待实现）
    "teamId:...",     // Team ID 匹配（待实现）
    "*"               // 通配符：允许所有
  ]
}
```

**默认规则**：
- 文件不存在 → 允许（向后兼容）
- 空数组 → 拒绝所有
- 有匹配规则 → 允许
- 无匹配规则 → 拒绝（返回 DESKTOP_CALLER_NOT_ALLOWED）

## 下一步（T6）

- **截图实现**：CGDisplayCreateImage（observe.png）
- **AX 树实现**：AXUIElement 创建有界遍历（ax.json）
- **剩余方法**：find, click, typeText, hotkey, waitUntil, abort
- **WORKSPACE_ROOT 校验**：workspacePath 必须以 WORKSPACE_ROOT 为前缀

## 技术债（P1，不挡上线）

- **Code Signing 信息提取**：从进程获取 signingId 和 teamId（需要使用 cs API）
  - 目的：实现基于签名 ID 的 allowlist（可分发、可控）
  - 当前：allowlist 已支持 `pid:` 和 `*` 规则，功能完整

## 开发者笔记

### XPC Service 生命周期

XPC Service 由 launchd 管理，按需启动：
- Client 连接到 Mach service 时，launchd 自动启动 XPC Service
- 无活动连接时，XPC Service 可能被系统回收
- Host App 的 Start/Stop 按钮控制的是"是否接受新连接"，而不是 XPC Service 进程本身

### panic() 实现

```swift
func panic() {
    isAccepting = false  // 拒绝新请求
    // 等待当前请求完成（最多 5 秒）
    let deadline = Date().addingTimeInterval(5)
    while !activeRequests.isEmpty && Date() < deadline {
        Thread.sleep(forTimeInterval: 0.1)
    }
}
```

### launchd 注册说明

Mach XPC services 必须通过 launchd 注册才能按名称连接：
- `MachServices` 字段声明 service name
- `ProgramArguments` 指向 XPC 可执行文件路径
- `RunAtLoad` = false：按需启动，而非启动时加载

## msgcode-desktopctl CLI 用法

msgcode-desktopctl 是 msgcode Desktop Bridge 的命令行客户端，通过 XPC 与 Host 服务通信。

### 构建

```bash
cd mac/msgcode-desktopctl
swift build
```

### 命令

#### ping - 检查 Bridge 服务是否运行

```bash
.build/debug/msgcode-desktopctl ping
```

预期输出（exit 0）：
```json
{
  "jsonrpc": "2.0",
  "id": "...",
  "result": {
    "hostVersion": "0.1.0",
    "macos": "Version 26.2 (Build 25C56)",
    "permissions": {
      "accessibility": "denied",
      "screenRecording": "denied"
    },
    "bridge": {
      "schemaVersion": 1
    }
  }
}
```

#### doctor - 诊断权限状态

```bash
.build/debug/msgcode-desktopctl doctor
```

预期输出（exit 0）：
```json
{
  "result": {
    "healthy": false,
    "permissions": {...},
    "issues": ["Accessibility permission denied", "Screen Recording permission denied"]
  },
  "jsonrpc": "2.0",
  "id": "..."
}
```

#### observe - 观察桌面状态并落盘证据

```bash
.build/debug/msgcode-desktopctl observe /Users/<you>/msgcode-workspaces/<workspace>
```

预期输出（exit 0）：
```json
{
  "result": {
    "executionId": "...",
    "evidence": {
      "dir": "/Users/<you>/msgcode-workspaces/<workspace>/artifacts/desktop/YYYY-MM-DD/...",
      "envPath": "env.json",
      "screenshotPath": "observe.png",
      "axPath": "ax.json"
    }
  },
  "jsonrpc": "2.0",
  "id": "..."
}
```

### 退出码

| 退出码 | 说明 |
|--------|------|
| 0 | 成功 |
| 2 | JSON-RPC 返回 error |
| 10 | Host 未运行或 XPC 连接失败 |

## 参考资料

- Contract 文档：`docs/desktop/contract.md`
- Apple XPC 文档：https://developer.apple.com/documentation/xpc
- Apple launchd.plist 文档：https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html
