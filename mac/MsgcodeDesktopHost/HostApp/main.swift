//
//  main.swift
//  MsgcodeDesktopHost (Menubar App)
//
//  Host menubar app: 内置 Bridge Server（NSXPCListener）
//  Track A: 不再连接外部 XPC Service，Bridge 逻辑内置在本进程
//

import Cocoa
import OSLog
import ApplicationServices
import CryptoKit

// MARK: - Command Line Arguments

private var isLaunchdMode = false

// MARK: - Bridge Status Enum

enum BridgeStatus {
    case stopped
    case starting
    case running
    case failed
    case panic
}

// MARK: - Permission Status Enum

enum PermissionStatus {
    case granted
    case denied
}

// MARK: - Menu Item Tags

enum MenuItemTag: Int {
    case startBridge = 100
    case stopBridge = 101
    case panicStop = 102
    // T9-M0: 三键最小版
    case doctor = 200
    case observe = 201
    case openLatestEvidence = 202
}

// MARK: - App Delegate

class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private var statusBarMenu: NSMenu?
    private var bridgeServer: BridgeServer?

    // Logger
    private let logger = Logger(subsystem: "com.msgcode.desktop.host", category: "main")

    // Status indicators
    private var accessibilityStatus: PermissionStatus = .denied
    private var screenRecordingStatus: PermissionStatus = .denied
    private var bridgeStatus: BridgeStatus = .stopped

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMenubar()
        setupPermissionsMonitoring()

        logger.log("MsgcodeDesktopHost started (launchdMode: \(isLaunchdMode))")

        // LaunchAgent 模式：自动启动 Bridge，不显示 UI
        if isLaunchdMode {
            logger.log("LaunchAgent mode detected, starting bridge server...")
            startBridge()
            // 不显示 menubar
            return
        }

        // 正常 GUI 模式：自动启动 bridge
        startBridge()
    }

    func applicationWillTerminate(_ notification: Notification) {
        logger.log("MsgcodeDesktopHost terminating")
        stopBridge()
    }

    // MARK: - Menubar Setup

    private func setupMenubar() {
        // LaunchAgent 模式不创建 menubar
        if isLaunchdMode { return }

        // Create status item in menubar
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        // Set icon
        if let button = statusItem?.button {
            button.image = NSImage(systemSymbolName: "app.connected.to.app.below.fill", accessibilityDescription: "Msgcode Desktop Host")
            button.image?.isTemplate = true
        }

        // Create menu
        let menu = NSMenu()
        statusBarMenu = menu

        // T9-M0: 三键最小版（置顶）
        let doctorItem = menu.addItem(withTitle: "Doctor", action: #selector(doctorAction), keyEquivalent: "d")
        doctorItem.tag = MenuItemTag.doctor.rawValue

        let observeItem = menu.addItem(withTitle: "Observe", action: #selector(observeAction), keyEquivalent: "o")
        observeItem.tag = MenuItemTag.observe.rawValue

        let evidenceItem = menu.addItem(withTitle: "Open Latest Evidence", action: #selector(openLatestEvidence), keyEquivalent: "e")
        evidenceItem.tag = MenuItemTag.openLatestEvidence.rawValue

        menu.addItem(NSMenuItem.separator())

        // Status section
        menu.addItem(withTitle: "状态", action: #selector(openStatusWindow), keyEquivalent: "")
        menu.addItem(NSMenuItem.separator())

        // Bridge controls
        let startItem = menu.addItem(withTitle: "Start Bridge", action: #selector(startBridge), keyEquivalent: "s")
        startItem.tag = MenuItemTag.startBridge.rawValue

        let stopItem = menu.addItem(withTitle: "Stop Bridge", action: #selector(stopBridge), keyEquivalent: "t")
        stopItem.tag = MenuItemTag.stopBridge.rawValue

        menu.addItem(NSMenuItem.separator())

        // Panic Stop
        let panicItem = menu.addItem(withTitle: "Panic Stop", action: #selector(panicStop), keyEquivalent: "p")
        panicItem.tag = MenuItemTag.panicStop.rawValue

        menu.addItem(NSMenuItem.separator())

        // Quit
        menu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        statusItem?.menu = menu

        updateMenuStates()
    }

    // MARK: - Menu Actions

    // T9-M0: 三键最小版 - Doctor
    @objc private func doctorAction() {
        guard bridgeStatus == .running else {
            showAlert(title: "Bridge 未运行", message: "请先启动 Bridge 服务")
            return
        }

        // 调用 desktop.doctor 并显示结果
        logger.log("Calling desktop.doctor...")

        let workspacePath = FileManager.default.homeDirectoryForCurrentUser.path

        // 构造 JSON-RPC 请求
        let requestId = UUID().uuidString
        let request: [String: Any] = [
            "jsonrpc": "2.0",
            "id": requestId,
            "method": "desktop.doctor",
            "params": [
                "meta": [
                    "schemaVersion": 1,
                    "requestId": requestId,
                    "workspacePath": workspacePath,
                    "timeoutMs": 10000
                ]
            ]
        ]

        guard let requestData = try? JSONSerialization.data(withJSONObject: request),
              let requestJson = String(data: requestData, encoding: .utf8) else {
            showAlert(title: "错误", message: "无法构造请求")
            return
        }

        // 调用 Bridge（同步）
        callBridge(requestJson: requestJson) { responseJson in
            self.showDoctorResult(responseJson)
        }
    }

    // T9-M0: 三键最小版 - Observe
    @objc private func observeAction() {
        guard bridgeStatus == .running else {
            showAlert(title: "Bridge 未运行", message: "请先启动 Bridge 服务")
            return
        }

        logger.log("Calling desktop.observe...")

        let workspacePath = FileManager.default.homeDirectoryForCurrentUser.path

        // 构造 JSON-RPC 请求
        let requestId = UUID().uuidString
        let request: [String: Any] = [
            "jsonrpc": "2.0",
            "id": requestId,
            "method": "desktop.observe",
            "params": [
                "meta": [
                    "schemaVersion": 1,
                    "requestId": requestId,
                    "workspacePath": workspacePath,
                    "timeoutMs": 30000
                ],
                "options": [
                    "includeScreenshot": true,
                    "includeAxTree": true
                ]
            ]
        ]

        guard let requestData = try? JSONSerialization.data(withJSONObject: request),
              let requestJson = String(data: requestData, encoding: .utf8) else {
            showAlert(title: "错误", message: "无法构造请求")
            return
        }

        // 调用 Bridge（同步）
        callBridge(requestJson: requestJson) { responseJson in
            self.showObserveResult(responseJson)
        }
    }

    // T9-M0: 三键最小版 - Open Latest Evidence
    @objc private func openLatestEvidence() {
        let workspacePath = FileManager.default.homeDirectoryForCurrentUser.path
        let desktopDir = "\(workspacePath)/artifacts/desktop"

        guard FileManager.default.fileExists(atPath: desktopDir) else {
            showAlert(title: "未找到证据目录", message: desktopDir)
            return
        }

        // 查找最新的日期目录
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"

        var latestDateDir: String? = nil
        var latestDate = Date.distantPast

        if let dateDirs = try? FileManager.default.contentsOfDirectory(atPath: desktopDir) {
            for dateDir in dateDirs {
                if let date = dateFormatter.date(from: dateDir) {
                    if date > latestDate {
                        latestDate = date
                        latestDateDir = dateDir
                    }
                }
            }
        }

        guard let dateDir = latestDateDir else {
            showAlert(title: "未找到证据", message: "没有可用的执行记录")
            return
        }

        // 查找最新的 executionId 目录
        let datePath = "\(desktopDir)/\(dateDir)"
        var latestExecDir: String? = nil
        var latestModTime = TimeInterval(0)

        if let execDirs = try? FileManager.default.contentsOfDirectory(atPath: datePath) {
            for execDir in execDirs {
                let execPath = "\(datePath)/\(execDir)"
                if let attrs = try? FileManager.default.attributesOfItem(atPath: execPath),
                   let modTime = attrs[.modificationDate] as? Date {
                    if modTime.timeIntervalSince1970 > latestModTime {
                        latestModTime = modTime.timeIntervalSince1970
                        latestExecDir = execPath
                    }
                }
            }
        }

        guard let execDir = latestExecDir else {
            showAlert(title: "未找到证据", message: "没有可用的执行记录")
            return
        }

        // 打开 Finder 到证据目录
        NSWorkspace.shared.open(URL(fileURLWithPath: execDir))
        logger.log("Opened evidence directory: \(execDir)")
    }

    // 显示 Doctor 结果
    private func showDoctorResult(_ responseJson: String) {
        guard let data = responseJson.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            showAlert(title: "响应解析失败", message: responseJson)
            return
        }

        if let result = json["result"] as? [String: Any] {
            let permissions = result["permissions"] as? [String: Any] ?? [:]
            let issues = result["issues"] as? [String] ?? []
            let healthy = result["healthy"] as? Bool ?? false

            var message = ""
            if let accessibility = permissions["accessibility"] as? [String: Any] {
                let granted = accessibility["granted"] as? Bool ?? false
                message += "Accessibility: \(granted ? "✓" : "✗")\n"
            }
            if let screenRecording = permissions["screenRecording"] as? [String: Any] {
                let granted = screenRecording["granted"] as? Bool ?? false
                message += "Screen Recording: \(granted ? "✓" : "✗")\n"
            }

            if !issues.isEmpty {
                message += "\n问题:\n" + issues.joined(separator: "\n")
            }

            let title = healthy ? "系统健康 ✓" : "系统异常 ✗"
            showAlert(title: title, message: message)
        } else if let error = json["error"] as? [String: Any] {
            let code = error["code"] as? String ?? "UNKNOWN"
            let message = error["message"] as? String ?? "未知错误"
            showAlert(title: "Doctor 失败: \(code)", message: message)
        }
    }

    // 显示 Observe 结果 + 最后事件摘要
    private func showObserveResult(_ responseJson: String) {
        guard let data = responseJson.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            showAlert(title: "响应解析失败", message: responseJson)
            return
        }

        if let result = json["result"] as? [String: Any],
           let evidence = result["evidence"] as? [String: Any],
           let evidenceDir = evidence["dir"] as? String {
            // 读取 events.ndjson 最后一条事件
            var eventSummary = "无事件记录"
            let eventsPath = "\(evidenceDir)/events.ndjson"

            if FileManager.default.fileExists(atPath: eventsPath),
               let eventsContent = try? String(contentsOfFile: eventsPath) {
                let lines = eventsContent.components(separatedBy: "\n").filter { !$0.isEmpty }
                if let lastLine = lines.last,
                   let lastEvent = try? JSONSerialization.jsonObject(with: lastLine.data(using: .utf8)!) as? [String: Any] {
                    if let type = lastEvent["type"] as? String {
                        eventSummary = "最后事件: \(type)"
                        if let timestamp = lastEvent["timestamp"] as? String {
                            eventSummary += "\n时间: \(timestamp)"
                        }
                    }
                }
            }

            var message = "证据目录: \(evidenceDir)\n\n\(eventSummary)"

            // 显示权限缺失
            if let permsMissing = evidence["permissionsMissing"] as? [String] {
                message += "\n\n缺失权限:\n" + permsMissing.joined(separator: ", ")
            }

            showAlert(title: "Observe 完成", message: message)

            // 询问是否打开证据目录
            let alert = NSAlert()
            alert.messageText = "打开证据目录?"
            alert.informativeText = evidenceDir
            alert.alertStyle = .informational  // 修复：.question 不存在
            alert.addButton(withTitle: "打开")
            alert.addButton(withTitle: "取消")

            if alert.runModal() == .alertFirstButtonReturn {
                NSWorkspace.shared.open(URL(fileURLWithPath: evidenceDir))
            }
        } else if let error = json["error"] as? [String: Any] {
            let code = error["code"] as? String ?? "UNKNOWN"
            let message = error["message"] as? String ?? "未知错误"
            showAlert(title: "Observe 失败: \(code)", message: message)
        }
    }

    // 通用 Bridge 调用（T9.M0.4: Menubar 显式 internal，peer: nil）
    private func callBridge(requestJson: String, completion: @escaping (String) -> Void) {
        guard let server = bridgeServer else {
            completion("{\"error\":{\"code\":\"INTERNAL_ERROR\",\"message\":\"Bridge server not available\"}}")
            return
        }

        // T9.M0.4: Menubar 进程内调用，传递 peer: nil（显式 internal）
        // 同步调用 handleJsonRpc
        let responseJson = server.handleJsonRpc(requestJson: requestJson, peer: nil)
        completion(responseJson)
    }

    // 辅助：显示 Alert
    private func showAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    @objc private func openStatusWindow() {
        let alert = NSAlert()
        alert.messageText = "Msgcode Desktop Host 状态"
        alert.informativeText = formatStatusString()
        alert.alertStyle = .informational
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    @objc private func startBridge() {
        guard bridgeStatus != .running else {
            logger.log("Bridge already running")
            return
        }

        logger.log("Starting bridge...")
        bridgeStatus = .starting
        updateMenuStates()

        // Track A: 创建并启动 Bridge Server（内置 NSXPCListener）
        bridgeServer = BridgeServer(launchdMode: isLaunchdMode)
        let success = bridgeServer?.startService() ?? false

        if success {
            bridgeStatus = .running
            logger.log("Bridge started successfully (NSXPCListener listening)")
        } else {
            bridgeStatus = .failed
            logger.error("Bridge failed to start")
        }

        updateMenuStates()
    }

    @objc private func stopBridge() {
        logger.log("Stopping bridge...")

        // Track A: 停止 Bridge Server（invalidate listener）
        bridgeServer?.stopService()
        bridgeServer = nil

        bridgeStatus = .stopped
        updateMenuStates()
        logger.log("Bridge stopped")
    }

    @objc private func panicStop() {
        logger.log("PANIC STOP triggered!")

        // Stop Bridge Server
        bridgeServer?.stopService()
        bridgeServer = nil

        bridgeStatus = .panic
        updateMenuStates()

        // Show alert
        if !isLaunchdMode {
            let alert = NSAlert()
            alert.messageText = "Panic Stop"
            alert.informativeText = "Bridge 已紧急停止，不再处理新请求。请检查系统状态。"
            alert.alertStyle = .warning
            alert.addButton(withTitle: "OK")
            alert.runModal()

            // Reset after 5 seconds
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
                self?.bridgeStatus = .stopped
                self?.updateMenuStates()
            }
        }
    }

    // MARK: - Permissions Monitoring

    private func setupPermissionsMonitoring() {
        // Monitor Screen Recording permissions via DistributedNotificationCenter
        DistributedNotificationCenter.default().addObserver(
            self,
            selector: #selector(screenRecordingChanged),
            name: NSNotification.Name("com.apple.screensharing.changed"),
            object: nil
        )

        // Initial check
        checkPermissions()

        // Periodic check every 5 seconds
        Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.checkPermissions()
        }
    }

    @objc private func screenRecordingChanged(_ notification: Notification) {
        checkPermissions()
    }

    private func checkPermissions() {
        let previousAccessibility = accessibilityStatus
        let previousScreenRecording = screenRecordingStatus

        // Check Accessibility
        if #available(macOS 14.0, *) {
            accessibilityStatus = AXIsProcessTrusted() ? .granted : .denied
        } else {
            accessibilityStatus = .denied
        }

        // Check Screen Recording
        if CGPreflightScreenCaptureAccess() {
            screenRecordingStatus = .granted
        } else {
            screenRecordingStatus = .denied
        }

        // Update UI if changed
        if previousAccessibility != accessibilityStatus || previousScreenRecording != screenRecordingStatus {
            updateMenuStates()
        }
    }

    // MARK: - UI Updates

    private func updateMenuStates() {
        guard let menu = statusBarMenu else { return }

        // Update bridge control items
        if let startItem = menu.item(withTag: MenuItemTag.startBridge.rawValue) {
            startItem.isEnabled = (bridgeStatus == .stopped)
            startItem.state = bridgeStatus == .running ? .on : .off
        }

        if let stopItem = menu.item(withTag: MenuItemTag.stopBridge.rawValue) {
            stopItem.isEnabled = (bridgeStatus == .running)
        }

        // Update status item icon
        updateStatusIcon()
    }

    private func updateStatusIcon() {
        guard let button = statusItem?.button else { return }

        var iconName = "circle"  // 默认：灰色圆圈（停止）

        switch bridgeStatus {
        case .stopped:
            iconName = "stop.circle"  // 停止图标（空心，自动反色）
        case .starting:
            iconName = "arrow.triangle.2.circlepath"  // 旋转箭头（启动中）
        case .running:
            iconName = "checkmark.circle"  // 勾号（运行中）
        case .failed:
            iconName = "xmark.circle"  // 叉号（失败）
        case .panic:
            iconName = "exclamationmark.triangle"  // 感叹号（紧急停止）
        }

        let image = NSImage(systemSymbolName: iconName, accessibilityDescription: "Msgcode Desktop Host")
        image?.isTemplate = true  // 使用 template 模式，系统自动反色适配背景
        button.image = image
    }

    // MARK: - Helpers

    private func formatStatusString() -> String {
        let accessibility = accessibilityStatus == .granted ? "✓" : "✗"
        let screenRecording = screenRecordingStatus == .granted ? "✓" : "✗"
        let bridge = formatBridgeStatus()

        return """
        权限状态

        Accessibility: \(accessibility)
        Screen Recording: \(screenRecording)

        Bridge: \(bridge)

        进程模式: \(isLaunchdMode ? "LaunchAgent (后台)" : "GUI (前台)")
        """
    }

    private func formatBridgeStatus() -> String {
        switch bridgeStatus {
        case .stopped: return "已停止"
        case .starting: return "启动中..."
        case .running: return "运行中"
        case .failed: return "启动失败"
        case .panic: return "紧急停止"
        }
    }
}

// MARK: - App Controller

func main() {
    let args = CommandLine.arguments

    // Track A: 检测 --launchd 参数（LaunchAgent 模式）
    if args.contains("--launchd") {
        isLaunchdMode = true

        // LaunchAgent 模式：直接运行 XPC listener，不使用 NSApplication
        let logger = Logger(subsystem: "com.msgcode.desktop.host", category: "main")
        logger.log("LaunchAgent mode: starting Bridge Server directly")

        // 必须在主线程创建 NSXPCListener
        let bridgeServer = BridgeServer(launchdMode: true)

        // 给一点时间让系统完全初始化
        Thread.sleep(forTimeInterval: 0.1)

        if bridgeServer.startService() {
            logger.log("Bridge Server started in LaunchAgent mode")

            // 保持进程运行（使用 RunLoop）
            let runLoop = RunLoop.current
            logger.log("Entering RunLoop...")
            repeat {
                let interval = Date(timeIntervalSinceNow: 1.0)
                _ = runLoop.run(mode: .default, before: interval)
            } while bridgeServer.isAccepting

            logger.log("Exiting RunLoop...")
        } else {
            logger.error("Failed to start Bridge Server")
            exit(1)
        }

        logger.log("LaunchAgent mode exiting")
        return
    }

    // GUI 模式：使用 NSApplication
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate

    app.run()
}

main()
