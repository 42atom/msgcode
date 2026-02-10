# MsgcodeDesktopHost

msgcode Desktop Bridge Host App - 内置 XPC Listener 的 Mach Service

## 架构变更 (Track A)

**之前（独立 XPC Service）：**
```
┌─────────────────────┐
│  MsgcodeDesktopHost │ (GUI App, XPC Client)
│  HostApp/main.swift │
└──────────┬──────────┘
           │ NSXPCConnection
           ▼
┌─────────────────────┐
│   BridgeXPC.xpc    │ (独立 XPC Service)
│  BridgeXPC/main.swift│
└─────────────────────┘
```

**现在（内置 Bridge Server）：**
```
┌─────────────────────────────────────┐
│      MsgcodeDesktopHost             │
│  ┌─────────────────────────────────┐│
│  │   BridgeServer.swift            ││
│  │   - NSXPCListener               ││
│  │   - BridgeServerAdapter         ││
│  │   - T7.0: captureScreenshot()   ││
│  │   - T7.1: serializeAXTree()     ││
│  └─────────────────────────────────┘│
│  HostApp/main.swift (--launchd)    │
└─────────────────────────────────────┘
```

**关键变化：**
- Bridge Server (NSXPCListener) 现在运行在 HostApp 进程内
- 不再生成独立的 MsgcodeDesktopBridge.xpc
- TCC 权限检查现在指向 HostApp 进程（com.msgcode.desktop.host）
- 用户只需授权 MsgcodeDesktopHost.app，无需单独授权 XPC Service

## 目录结构

```
MsgcodeDesktopHost/
├── BridgeServer.swift          # Track A: 内置 XPC Listener + Bridge Adapter
├── BridgeXPC/
│   ├── BridgeXPCProtocol.swift  # XPC Protocol 定义 (BridgeError + JSONRPC)
│   └── (main.swift 已废弃)
├── HostApp/
│   └── main.swift              # 修改：集成 BridgeServer，支持 --launchd
├── build.sh                    # 修改：只编译 HostApp，不再生成 .xpc
├── register_launchagent.sh     # Track B: LaunchAgent 管理脚本
└── MsgcodeDesktopHost.app/     # 构建输出
    └── Contents/
        └── MacOS/
            └── MsgcodeDesktopHost
```

## 使用方式

### GUI 模式
```bash
open MsgcodeDesktopHost.app
# 或双击 App
```

### LaunchAgent 模式
```bash
# 注册 LaunchAgent
bash register_launchagent.sh install

# 启动服务
launchctl start com.msgcode.desktop.bridge

# 停止服务
launchctl stop com.msgcode.desktop.bridge

# 卸载
bash register_launchagent.sh uninstall

# 查看状态
bash register_launchagent.sh status
```

## 验收标准

### Track A 交付物验收
- [x] BridgeServer.swift 包含完整的 NSXPCListener + BridgeServerAdapter
- [x] HostApp/main.swift 集成 BridgeServer
- [x] build.sh 只编译 HostApp，不生成 .xpc
- [x] MsgcodeDesktopHost.app 启动正常，PlugIns/ 无 .xpc

### Track B 交付物验收
- [x] register_launchagent.sh 支持 install/uninstall/status
- [x] LaunchAgent plist 正确导出 MachServices
- [x] launchctl list 显示 job 运行中

### 联合验收（权限授权后）
- [ ] 只授权 MsgcodeDesktopHost.app (com.msgcode.desktop.host)
- [ ] `npm run desktop:smoke` 或 `bash scripts/desktop/smoke-desktop-toolbus.sh` PASS
- [ ] observe 生成 3 个文件：observe.png + ax.json + env.json
- [ ] 禁止硬编码绝对路径（建议检查：`rg "/Users/" mac/MsgcodeDesktopHost -S` 应无命中）

## 权限授权

首次运行需要授予以下权限：

1. **系统设置 → 隐私与安全性 → 辅助功能**
   - 添加 `MsgcodeDesktopHost`

2. **系统设置 → 隐私与安全性 → 屏幕录制**
   - 添加 `MsgcodeDesktopHost`

## 权限稳定性规则

### 核心结论

**`build.sh` 会重建 `.app` bundle，macOS TCC（权限系统）可能将其识别为"新应用"，导致已授权的 Accessibility/Screen Recording 权限重置为 `denied`。**

这是 macOS 的标准安全机制，非 Bug。触发条件包括但不限于：
- `.app` bundle 被删除后重建
- 代码签名变化（从无签名到签名、签名 identity 变化）
- `.app` 文件路径变化
- `.app` 内部可执行文件的修改时间变化

### 标准开发流程（避免权限反复丢失）

```
┌─────────────────────────────────────────────────────────┐
│ 1. build.sh（编译）                                      │
├─────────────────────────────────────────────────────────┤
│ 2. 授权权限                                              │
│    → 系统设置 → 隐私与安全性 → 辅助功能                 │
│    → 系统设置 → 隐私与安全性 → 屏幕录制                 │
├─────────────────────────────────────────────────────────┤
│ 3. register_launchagent.sh install                      │
├─────────────────────────────────────────────────────────┤
│ 4. npm run desktop:smoke（验收）                        │
└─────────────────────────────────────────────────────────┘
```

**⚠️ 关键规则：**
- ✅ **先 build → 再授权 → 再安装 → 再测试**
- ❌ **禁止：已授权后立刻 rebuild**（会导致权限丢失，需重新勾选）
- ✅ **开发调试：改 Swift 代码后若要 rebuild，必须预留重新授权的时间**

### 权限丢失的快速检测

```bash
# 方法 1: smoke test 会直接报告
npm run desktop:smoke
# 输出包含：权限缺失: accessibility,screenRecording

# 方法 2: desktopctl doctor 检查健康状态
./mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl doctor --workspace .
# 输出：issues: ['Screen Recording permission denied']
```

### 临时缓解方案（仅供实验，不推荐生产使用）

若需频繁 rebuild 且不想反复授权，可考虑：
- 使用固定代码签名（`codesign --force --deep --sign "Developer ID" MsgcodeDesktopHost.app`）
- 避免删除 `.app`，仅覆盖内部可执行文件

但以上方案仍可能被 TCC 重置，**最稳妥的做法仍是遵循标准流程**。

## 测试

```bash
# 构建
bash build.sh

# 注册 LaunchAgent
bash register_launchagent.sh install

# 测试 Bridge
cd ../msgcode
./mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl ping --workspace .
./mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl doctor --workspace .
./mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl observe "$PWD"

# 运行 smoke test
bash scripts/desktop/smoke-desktop-toolbus.sh
```

## 故障排查

### 检查进程
```bash
ps aux | grep "MsgcodeDesktopHost.*--launchd" | grep -v grep
```

### 检查 LaunchAgent
```bash
launchctl list | grep com.msgcode.desktop.bridge
```

### 查看日志
```bash
log stream --predicate 'process == "MsgcodeDesktopHost"' --level debug
```

### 重置权限
```bash
sudo tccutil reset Accessibility com.msgcode.desktop.host
sudo tccutil reset ScreenCapture com.msgcode.desktop.host
```

### 完全重置
```bash
# 卸载 LaunchAgent
bash register_launchagent.sh uninstall

# 重置权限
sudo tccutil reset All com.msgcode.desktop.host

# 重新构建
bash build.sh

# 重新安装
bash register_launchagent.sh install
```
