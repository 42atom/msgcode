//
//  BridgeServer.swift
//  MsgcodeDesktopHost - 内置 XPC Listener
//
//  将原 BridgeXPC Service 的逻辑迁移到 HostApp 进程内
//  这样 TCC 权限自然继承，无需单独授权 XPC Service
//

import Foundation
import Cocoa
import OSLog
import ApplicationServices
import CryptoKit

// MARK: - Data Extension for SHA256

extension Data {
    /// 计算 SHA256 哈希
    func sha256() -> Data {
        return Data(SHA256.hash(data: self))
    }
}

// MARK: - Date Extension for Evidence Directories

extension Date {
    /// 格式化为 yyyy-MM-dd（用于证据目录）
    var yyyyMMdd: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: self)
    }
}

// MARK: - Peer Identity

/// Peer 身份信息：从 XPC connection 提取
struct PeerIdentity {
    let pid: pid_t
    let auditTokenDigest: String
    let signingId: String?
    let teamId: String?
}

// MARK: - Token Record（T8.6）

/// Token 记录：用于一次性确认令牌
struct TokenRecord {
    let token: String
    let expiresAt: Date
    let scope: TokenScope
    let peer: TokenPeer
    var used: Bool = false
}

/// Token 作用域：绑定 method + paramsDigest
struct TokenScope {
    let method: String
    let paramsDigest: String
}

/// Token peer：绑定调用者身份
struct TokenPeer {
    let auditTokenDigest: String
    let pid: pid_t
}

// MARK: - Bridge Server

/// Bridge Server：内置在 HostApp 进程内的 XPC Listener
class BridgeServer: NSObject, NSXPCListenerDelegate {
    private let logger = Logger(subsystem: "com.msgcode.desktop.host", category: "BridgeServer")
    private var listener: NSXPCListener?
    var isAccepting = false  // 内部访问控制
    private var activeRequests: Set<String> = []
    private var abortedRequests: Set<String> = []  // T8.3: 被中止的请求集合
    private let requestsLock = NSLock()  // 保护 activeRequests/abortedRequests 的线程安全
    // T8.6: token store（内存存储，进程重启后清空）
    private var issuedTokens: [String: TokenRecord] = [:]
    private let tokensLock = NSLock()  // 保护 issuedTokens 的线程安全
    private let launchdMode: Bool

    /// 初始化 Bridge Server
    init(launchdMode: Bool = false) {
        self.launchdMode = launchdMode
        super.init()
    }

    // MARK: - Server Lifecycle

    /// 启动 Bridge Server（NSXPCListener）
    func startService() -> Bool {
        logger.log("Bridge Server starting... (launchdMode: \(self.launchdMode))")

        // 创建 Mach service listener
        // 统一使用 machServiceName 方式（LaunchAgent 和 GUI 模式都兼容）
        // NSXPCListener(machServiceName:) 会向系统注册 Mach service
        let listener = NSXPCListener(machServiceName: "com.msgcode.desktop.bridge")
        listener.delegate = self
        self.listener = listener

        // 开始接受连接
        listener.resume()
        isAccepting = true

        logger.log("Bridge Server started and accepting connections")
        return true
    }

    /// 停止接受新连接（Stop）
    func stopService() {
        logger.log("Bridge Server stopping...")
        listener?.invalidate()
        isAccepting = false
        logger.log("Bridge Server stopped")
    }

    /// Panic: 停止接受新连接并中止当前请求
    func panic() {
        logger.log("Bridge Server PANIC: stopping all operations")
        isAccepting = false

        // 等待当前请求完成（最多 5 秒）
        let deadline = Date().addingTimeInterval(5)
        while !isRequestsEmpty() && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.1)
        }

        if !isRequestsEmpty() {
            logger.error("Panic: some requests did not complete in time")
        }
    }

    /// 线程安全地检查是否有活跃请求
    private func isRequestsEmpty() -> Bool {
        requestsLock.lock()
        defer { requestsLock.unlock() }
        return activeRequests.isEmpty
    }

    // MARK: - NSXPCListenerDelegate

    public func listener(_ listener: NSXPCListener, shouldAcceptNewConnection newConnection: NSXPCConnection) -> Bool {
        // 检查是否接受新连接
        guard isAccepting else {
            logger.log("Rejecting connection: server not accepting")
            return false
        }

        // 配置连接
        newConnection.exportedInterface = NSXPCInterface(with: BridgeXPCProtocol.self)
        newConnection.exportedObject = BridgeServerAdapter(server: self, connection: newConnection)
        newConnection.resume()

        logger.log("Accepted new XPC connection")
        return true
    }

    /// 注册活动请求（用于 single-flight abort，线程安全）
    func registerRequest(_ id: String) {
        requestsLock.lock()
        defer { requestsLock.unlock() }
        activeRequests.insert(id)
    }

    /// 检查请求是否被中止
    func isRequestAborted(_ id: String) -> Bool {
        requestsLock.lock()
        defer { requestsLock.unlock() }
        return abortedRequests.contains(id)
    }

    /// 中止指定请求（T8.3）
    func abortRequest(_ id: String) -> Bool {
        requestsLock.lock()
        defer { requestsLock.unlock() }
        return abortedRequests.insert(id).inserted
    }

    /// 清理已完成的请求（避免内存泄漏）
    func unregisterRequest(_ id: String) {
        requestsLock.lock()
        defer { requestsLock.unlock() }
        activeRequests.remove(id)
        abortedRequests.remove(id)  // 同时从 abortedRequests 中移除
    }

    // MARK: - Token Management（T8.6）

    /// Token 验证结果
    enum TokenValidationResult {
        case success
        case invalid
        case used
        case expired
        case mismatch
    }

    /// desktop.confirm.issue: 签发一次性确认令牌
    internal func handleConfirmIssue(id: String, params: [String: Any], peer: PeerIdentity) -> String {
        // 解析 intent
        guard let intent = params["intent"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing intent")
        }

        guard let method = intent["method"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing intent.method")
        }

        guard let intentParams = intent["params"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing intent.params")
        }

        // 解析 TTL（默认 60s）
        let ttlMs = params["ttlMs"] as? Int ?? 60000
        let expiresAt = Date().addingTimeInterval(Double(ttlMs) / 1000.0)

        // 计算 paramsDigest
        let paramsDigest = computeParamsDigest(params: intentParams)

        // 生成 token
        let token = UUID().uuidString

        // 创建 TokenRecord
        let scope = TokenScope(method: method, paramsDigest: paramsDigest)
        let tokenPeer = TokenPeer(auditTokenDigest: peer.auditTokenDigest, pid: peer.pid)
        let record = TokenRecord(token: token, expiresAt: expiresAt, scope: scope, peer: tokenPeer, used: false)

        // 存储到 token store
        tokensLock.lock()
        issuedTokens[token] = record
        tokensLock.unlock()

        // 格式化 expiresAt 为 ISO 8601
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        let expiresAtStr = formatter.string(from: expiresAt)

        let result: [String: Any] = [
            "token": token,
            "expiresAt": expiresAtStr,
            "scope": [
                "method": method,
                "paramsDigest": paramsDigest
            ],
            "peer": [
                "auditTokenDigest": peer.auditTokenDigest,
                "pid": peer.pid
            ]
        ]

        return JSONRPC.success(id: id, result: result)
    }

    /// 验证 token（不消费，仅检查有效性）
    internal func validateToken(token: String, method: String, params: [String: Any], peer: PeerIdentity) -> TokenValidationResult {
        tokensLock.lock()
        defer { tokensLock.unlock() }

        guard let record = issuedTokens[token] else {
            return .invalid
        }

        // 检查是否已使用
        if record.used {
            return .used
        }

        // 检查是否过期
        if Date() > record.expiresAt {
            return .expired
        }

        // 检查 peer 绑定
        if record.peer.auditTokenDigest != peer.auditTokenDigest {
            return .mismatch
        }

        // 检查 method 绑定
        if record.scope.method != method {
            return .mismatch
        }

        // 检查 paramsDigest 绑定（排除 meta 和 confirm 字段，只绑定操作参数）
        var paramsForDigest = params
        paramsForDigest.removeValue(forKey: "meta")
        paramsForDigest.removeValue(forKey: "confirm")
        let paramsDigest = computeParamsDigest(params: paramsForDigest)
        if record.scope.paramsDigest != paramsDigest {
            return .mismatch
        }

        return .success
    }

    /// 消费 token（single-use，仅在动作即将执行前调用）
    internal func consumeToken(token: String) -> Bool {
        tokensLock.lock()
        defer { tokensLock.unlock() }

        guard let record = issuedTokens[token], !record.used else {
            return false
        }

        // 标记 used 并删除
        var consumedRecord = record
        consumedRecord.used = true
        issuedTokens[token] = consumedRecord  // 先标记 used
        issuedTokens.removeValue(forKey: token)  // 再删除（single-use）

        return true
    }

    /// 计算 paramsDigest（canonical JSON + SHA256 前 16 hex）
    private func computeParamsDigest(params: [String: Any]) -> String {
        // 使用 JSONSerialization 排序 key（canonical JSON）
        guard let jsonData = try? JSONSerialization.data(withJSONObject: params, options: [.sortedKeys]) else {
            return "INVALID_JSON"
        }

        // 计算 SHA256
        let digest = jsonData.sha256()

        // 转换为 hex 并取前 16 字符
        let hex = digest.map { String(format: "%02x", $0) }.joined()
        return String(hex.prefix(16))
    }
}

// MARK: - Bridge Server Adapter

/// Bridge Server 适配器：处理 XPC 调用并转发到 BridgeServer
class BridgeServerAdapter: NSObject, BridgeXPCProtocol {
    private let server: BridgeServer
    private let logger = Logger(subsystem: "com.msgcode.desktop.host", category: "Adapter")
    private let connection: NSXPCConnection
    private var cachedPeerIdentity: PeerIdentity?

    init(server: BridgeServer, connection: NSXPCConnection) {
        self.server = server
        self.connection = connection
    }

    /// 提取 peer 身份信息（T5.0）
    private func extractPeerIdentity() -> PeerIdentity {
        // 使用缓存的值
        if let cached = cachedPeerIdentity {
            return cached
        }

        let pid = connection.processIdentifier

        // 从 XPC connection 获取 auditToken（通过私有 API）
        var auditTokenData = Data()

        if let token = connection.value(forKey: "auditToken") as? Data {
            auditTokenData = token
        } else {
            logger.log("Warning: Could not extract auditToken, using pid as fallback")
            var pidBytes = pid.bigEndian
            auditTokenData = Data(bytes: &pidBytes, count: MemoryLayout<pid_t>.size)
        }

        // 计算 auditTokenDigest（SHA256，取前 16 字符作为摘要）
        let digest = auditTokenData.sha256().prefix(8).map { String(format: "%02x", $0) }.joined()

        // signingId 和 teamId：TODO [P1 技术债]
        let signingId: String? = nil
        let teamId: String? = nil

        let identity = PeerIdentity(
            pid: pid,
            auditTokenDigest: digest,
            signingId: signingId,
            teamId: teamId
        )

        // 缓存结果
        cachedPeerIdentity = identity

        return identity
    }

    /// 验证 allowlist（T5.1）
    /// - Parameter workspacePath: 工作区路径
    /// - Returns: true 允许，false 拒绝
    private func validateAllowlist(workspacePath: String) -> Bool {
        let allowlistPath = "\(workspacePath)/allowlist.json"

        // 文件不存在：默认允许
        guard FileManager.default.fileExists(atPath: allowlistPath) else {
            logger.log("Allowlist not found, allowing by default")
            return true
        }

        // 读取 allowlist.json
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: allowlistPath)),
              let allowlist = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            logger.log("Failed to parse allowlist.json, denying")
            return false
        }

        // 检查 callers 数组
        guard let callers = allowlist["callers"] as? [String] else {
            logger.log("Missing 'callers' in allowlist, treating as empty (deny all)")
            return false
        }

        // 空数组：拒绝所有
        if callers.isEmpty {
            logger.log("Allowlist is empty, denying all callers")
            return false
        }

        // 提取 peer 信息
        let peer = extractPeerIdentity()

        // 检查是否匹配 allowlist 中的任何规则
        let allowed = callers.contains { rule in
            if rule == "*" {
                return true
            }
            if rule.hasPrefix("pid:") {
                let ruleStr = rule.dropFirst(4)
                if let targetPid = pid_t(ruleStr) {
                    return peer.pid == targetPid
                }
            }
            return false
        }

        if allowed {
            logger.log("Caller allowed by allowlist (pid: \(peer.pid))")
        } else {
            logger.log("Caller denied by allowlist (pid: \(peer.pid))")
        }

        return allowed
    }

    /// 接收 JSON-RPC 请求并返回响应
    func sendMessage(_ requestJson: String, reply: @escaping (String) -> Void) {
        logger.log("Received request: \(requestJson.prefix(100))...")

        // 解析 JSON-RPC 请求
        guard let (id, method, params) = JSONRPC.parseRequest(requestJson) else {
            reply(JSONRPC.error(id: "", code: BridgeError.invalidRequest.code, message: "Invalid JSON-RPC request"))
            return
        }

        // 检查 service 是否停止
        guard server.isAccepting else {
            reply(JSONRPC.error(id: id, code: BridgeError.hostStopped.code, message: "Host is stopped"))
            return
        }

        // T5.1: allowlist 验证（需要 workspacePath）
        if let meta = params["meta"] as? [String: Any],
           let workspacePath = meta["workspacePath"] as? String {
            if !validateAllowlist(workspacePath: workspacePath) {
                reply(JSONRPC.error(id: id, code: BridgeError.callerNotAllowed.code, message: "Caller not allowed by allowlist"))
                return
            }
        }

        // 注册请求
        server.registerRequest(id)

        // 处理请求（异步，避免阻塞 XPC 线程）
        // T8.6: 提取 peer 信息用于 token 签发/校验
        let peer = extractPeerIdentity()
        DispatchQueue.global(qos: .userInitiated).async { [weak server] in
            let response = self.handleRequest(id: id, method: method, params: params, peer: peer)
            server?.unregisterRequest(id)
            reply(response)
        }
    }

    /// 处理具体方法
    private func handleRequest(id: String, method: String, params: [String: Any], peer: PeerIdentity) -> String {
        switch method {
        case "desktop.health":
            return handleHealth(id: id, params: params, peer: peer)
        case "desktop.doctor":
            return handleDoctor(id: id, params: params, peer: peer)
        case "desktop.observe":
            return handleObserve(id: id, params: params)
        case "desktop.find":
            return handleFind(id: id, params: params)
        case "desktop.click":
            return handleClick(id: id, params: params, peer: peer)
        case "desktop.typeText":
            return handleTypeText(id: id, params: params, peer: peer)
        case "desktop.hotkey":
            return handleHotkey(id: id, params: params, peer: peer)
        case "desktop.waitUntil":
            return handleWaitUntil(id: id, params: params)
        case "desktop.abort":
            return handleAbort(id: id, params: params)
        case "desktop.confirm.issue":
            return server.handleConfirmIssue(id: id, params: params, peer: peer)
        default:
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Unknown method: \(method)")
        }
    }

    // MARK: - P0 方法实现

    /// desktop.health: 返回 Host 版本和权限状态
    private func handleHealth(id: String, params: [String: Any], peer: PeerIdentity) -> String {
        // meta 是必需的，但 health 不需要使用它
        guard params["meta"] is [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing meta")
        }

        let accessibility = AXIsProcessTrusted()
        let screenRecording = CGPreflightScreenCaptureAccess()

        // T8.6.4.1: 构造 peer 信息（peer 稳定性证据）
        var peerData: [String: Any] = [
            "pid": peer.pid,
            "auditTokenDigest": peer.auditTokenDigest
        ]
        if let signingId = peer.signingId {
            peerData["signingId"] = signingId
        }
        if let teamId = peer.teamId {
            peerData["teamId"] = teamId
        }

        let result: [String: Any] = [
            "hostVersion": "0.1.0",
            "macos": ProcessInfo.processInfo.operatingSystemVersionString,
            "permissions": [
                "accessibility": accessibility ? "granted" : "denied",
                "screenRecording": screenRecording ? "granted" : "denied"
            ],
            "bridge": [
                "schemaVersion": 1
            ],
            "peer": peerData  // T8.6.4.1: 添加 peer 信息
        ]

        return JSONRPC.success(id: id, result: result)
    }

    /// desktop.doctor: 详细诊断权限状态
    private func handleDoctor(id: String, params: [String: Any], peer: PeerIdentity) -> String {
        let accessibility = AXIsProcessTrusted()
        let screenRecording = CGPreflightScreenCaptureAccess()

        var issues: [String] = []
        if !accessibility {
            issues.append("Accessibility permission denied")
        }
        if !screenRecording {
            issues.append("Screen Recording permission denied")
        }

        // P0.5: 添加 peer 信息（与 desktop.health 对齐）
        var peerData: [String: Any] = [
            "pid": peer.pid,
            "auditTokenDigest": peer.auditTokenDigest
        ]
        if let signingId = peer.signingId {
            peerData["signingId"] = signingId
        }
        if let teamId = peer.teamId {
            peerData["teamId"] = teamId
        }

        let result: [String: Any] = [
            "permissions": [
                "accessibility": [
                    "granted": accessibility,
                    "required": true,
                    "purpose": "AX observe/find/action"
                ],
                "screenRecording": [
                    "granted": screenRecording,
                    "required": true,
                    "purpose": "Screenshot capture"
                ]
            ],
            "issues": issues,
            "healthy": issues.isEmpty,
            "peer": peerData  // P0.5: 添加 peer 信息
        ]

        return JSONRPC.success(id: id, result: result)
    }

    /// desktop.observe: 截图 + AX 树，落盘证据
    private func handleObserve(id: String, params: [String: Any]) -> String {
        guard let meta = params["meta"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing meta")
        }

        guard let workspacePath = meta["workspacePath"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing workspacePath")
        }

        // 创建证据目录
        let executionId = UUID().uuidString
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let dateStr = dateFormatter.string(from: Date())

        let evidenceDir = "\(workspacePath)/artifacts/desktop/\(dateStr)/\(executionId)"

        do {
            try FileManager.default.createDirectory(atPath: evidenceDir, withIntermediateDirectories: true)
        } catch {
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to create evidence directory: \(error)")
        }

        // 提取 peer 身份信息
        let peer = extractPeerIdentity()

        // Host 信息
        let hostPid = ProcessInfo.processInfo.processIdentifier
        let hostBundleId = Bundle.main.bundleIdentifier ?? "com.msgcode.desktop.host"

        // 落盘 env.json
        let envPath = "\(evidenceDir)/env.json"
        var peerData: [String: Any] = [
            "pid": peer.pid,
            "auditTokenDigest": peer.auditTokenDigest
        ]
        if let signingId = peer.signingId {
            peerData["signingId"] = signingId
        }
        if let teamId = peer.teamId {
            peerData["teamId"] = teamId
        }

        let envData: [String: Any] = [
            "executionId": executionId,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "workspacePath": workspacePath,
            "peer": peerData,
            "host": [
                "pid": hostPid,
                "bundleId": hostBundleId,
                "version": "0.1.0"
            ],
            "permissions": [
                "accessibility": AXIsProcessTrusted(),
                "screenRecording": CGPreflightScreenCaptureAccess()
            ]
        ]

        do {
            let jsonData = try JSONSerialization.data(withJSONObject: envData, options: [.prettyPrinted])
            try jsonData.write(to: URL(fileURLWithPath: envPath))
        } catch {
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to write env.json: \(error)")
        }

        // T7.0 + T7.1: 截图 + AX 树（有界遍历）
        let accessibilityGranted = AXIsProcessTrusted()
        let screenRecordingGranted = CGPreflightScreenCaptureAccess()
        var permissionsMissing: [String] = []
        if !accessibilityGranted { permissionsMissing.append("accessibility") }
        if !screenRecordingGranted { permissionsMissing.append("screenRecording") }

        // 截图 (observe.png)
        var screenshotPath: String? = nil
        if screenRecordingGranted {
            if captureScreenshot(to: evidenceDir) {
                screenshotPath = "observe.png"
            }
        }

        // AX 树 (ax.json)
        var axPath: String? = nil
        if accessibilityGranted {
            if serializeAXTree(to: evidenceDir) != nil {
                axPath = "ax.json"
            }
        }

        // 构建证据返回（诚实返回）
        var evidence: [String: Any] = [
            "dir": evidenceDir,
            "envPath": "env.json"
        ]

        if let sp = screenshotPath {
            evidence["screenshotPath"] = sp
        }
        if let ap = axPath {
            evidence["axPath"] = ap
        }

        if !permissionsMissing.isEmpty {
            evidence["permissionsMissing"] = permissionsMissing
        }

        let result: [String: Any] = [
            "executionId": executionId,
            "evidence": evidence
        ]

        return JSONRPC.success(id: id, result: result)
    }

    /// desktop.find: 查找 UI 元素（T8.1）
    private func handleFind(id: String, params: [String: Any]) -> String {
        // 检查 Accessibility 权限
        guard AXIsProcessTrusted() else {
            return JSONRPC.error(id: id, code: BridgeError.permissionMissing.code, message: "Accessibility permission required")
        }

        // 解析 meta
        guard let meta = params["meta"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing meta")
        }

        guard let workspacePath = meta["workspacePath"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing workspacePath")
        }

        // 解析 selector（可选）
        var selectorByRole: String? = nil
        var selectorTitleContains: String? = nil
        var selectorValueContains: String? = nil
        var limit = 10

        if let selector = params["selector"] as? [String: Any] {
            if let byRole = selector["byRole"] as? String {
                selectorByRole = byRole
            }
            if let titleContains = selector["titleContains"] as? String {
                selectorTitleContains = titleContains
            }
            if let valueContains = selector["valueContains"] as? String {
                selectorValueContains = valueContains
            }
            if let lim = selector["limit"] as? Int {
                limit = lim
            }
        }

        // 创建证据目录
        let executionId = UUID().uuidString
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let dateStr = dateFormatter.string(from: Date())

        let evidenceDir = "\(workspacePath)/artifacts/desktop/\(dateStr)/\(executionId)"

        do {
            try FileManager.default.createDirectory(atPath: evidenceDir, withIntermediateDirectories: true)
        } catch {
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to create evidence directory: \(error)")
        }

        // T7.A4: 获取前台应用作为根元素
        var rootElement: AXUIElement?

        if #available(macOS 14.0, *) {
            let workspace = NSWorkspace.shared
            if let app = workspace.frontmostApplication {
                logger.log("Find in frontmost app: \(app.bundleIdentifier ?? "unknown") (pid: \(app.processIdentifier))")
                rootElement = AXUIElementCreateApplication(app.processIdentifier)
            }
        }

        // 兜底：如果无法获取前台应用，使用 systemWide
        if rootElement == nil {
            logger.log("Failed to get frontmost app, falling back to systemWide")
            rootElement = AXUIElementCreateSystemWide()
        }

        guard let unwrappedRootElement = rootElement else {
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to create root element")
        }

        // 遍历 AX 树查找匹配元素
        var elementRefs: [[String: Any]] = []
        var nodesVisited = 0
        let maxNodes = 5000

        func traverse(_ element: AXUIElement, depth: Int) {
            // 检查是否被中止
            if server.isRequestAborted(id) {
                return
            }

            // 边界检查
            guard nodesVisited < maxNodes else { return }
            nodesVisited += 1

            // 提取元素属性
            let role = copyAXValue(element, attribute: kAXRoleAttribute) as? String
            let title = copyAXValue(element, attribute: kAXTitleAttribute) as? String
            let value = copyAXValue(element, attribute: kAXValueAttribute)
            let position = copyAXValue(element, attribute: kAXPositionAttribute) as? [String: Any]
            let size = copyAXValue(element, attribute: kAXSizeAttribute) as? [String: Any]

            // 应用 selector 过滤
            var matches = true

            if let byRole = selectorByRole {
                if role != byRole {
                    matches = false
                }
            }

            if let titleContains = selectorTitleContains {
                if let t = title, !t.contains(titleContains) {
                    matches = false
                } else if title == nil {
                    matches = false
                }
            }

            if let valueContains = selectorValueContains {
                if let v = value as? String, !v.contains(valueContains) {
                    matches = false
                } else if !(value is String) {
                    matches = false
                }
            }

            // 如果匹配且未达到 limit，添加到结果
            if matches && elementRefs.count < limit {
                var frame: [String: Any]? = nil
                if let pos = position, let sz = size {
                    if let x = pos["x"] as? Int, let y = pos["y"] as? Int,
                       let w = sz["width"] as? Int, let h = sz["height"] as? Int {
                        frame = ["x": x, "y": y, "width": w, "height": h]
                    }
                }

                // 生成 fingerprint（role + title + frame 的拼接）
                var fingerprintParts: [String] = []
                if let r = role { fingerprintParts.append(r) }
                if let t = title { fingerprintParts.append(t) }
                if let f = frame {
                    fingerprintParts.append("x=\(f["x"] ?? 0),y=\(f["y"] ?? 0),w=\(f["width"] ?? 0),h=\(f["height"] ?? 0)")
                }
                let fingerprint = fingerprintParts.joined(separator: "|")

                var elementRef: [String: Any] = [
                    "elementId": "e:\(elementRefs.count + 1)",
                    "fingerprint": fingerprint
                ]

                if let r = role { elementRef["role"] = r }
                if let t = title { elementRef["title"] = t }
                if let v = value { elementRef["value"] = v }
                if let f = frame { elementRef["frame"] = f }

                elementRefs.append(elementRef)
            }

            // 递归遍历子元素（深度限制 20，避免过深）
            if depth < 20 {
                if let children = copyAXValue(element, attribute: kAXChildrenAttribute) as? [AXUIElement] {
                    for child in children {
                        traverse(child, depth: depth + 1)
                        // 达到 limit 后停止
                        if elementRefs.count >= limit {
                            break
                        }
                    }
                }
            }
        }

        // 开始遍历
        traverse(unwrappedRootElement, depth: 0)

        // 写入 ax.json（证据）
        let axPath = "\(evidenceDir)/ax.json"
        do {
            var selectorData: [String: Any] = [:]
            if let byRole = selectorByRole { selectorData["byRole"] = byRole }
            if let titleContains = selectorTitleContains { selectorData["titleContains"] = titleContains }
            if let valueContains = selectorValueContains { selectorData["valueContains"] = valueContains }
            selectorData["limit"] = limit

            let axData: [String: Any] = [
                "executionId": executionId,
                "elementRefs": elementRefs,
                "matched": elementRefs.count,
                "nodesVisited": nodesVisited,
                "selector": selectorData
            ]
            let jsonData = try JSONSerialization.data(withJSONObject: axData, options: .prettyPrinted)
            try jsonData.write(to: URL(fileURLWithPath: axPath))
            logger.log("AX find result written to: \(axPath)")
        } catch {
            logger.error("Failed to write ax.json: \(error)")
        }

        // 构建返回结果
        let result: [String: Any] = [
            "executionId": executionId,
            "elementRefs": elementRefs,
            "matched": elementRefs.count,
            "evidence": [
                "dir": evidenceDir,
                "axPath": "ax.json"
            ]
        ]

        return JSONRPC.success(id: id, result: result)
    }

    /// desktop.click: 点击元素（T8.2）
    private func handleClick(id: String, params: [String: Any], peer: PeerIdentity) -> String {
        // T8.6: confirm gate 验证（token 优先，phrase 回退）
        guard let confirm = params["confirm"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Missing confirm object")
        }

        // 步骤 1: 验证 token（不消费）
        if let token = confirm["token"] as? String {
            let validationResult = server.validateToken(
                token: token,
                method: "desktop.click",
                params: params,
                peer: peer
            )
            switch validationResult {
            case .success:
                break  // token 有效，继续检查权限
            case .invalid:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Invalid token")
            case .used:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token already used")
            case .expired:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token expired")
            case .mismatch:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token scope mismatch")
            }
        } else if let phrase = confirm["phrase"] as? String {
            // Fallback to phrase validation
            guard phrase == "CONFIRM" || phrase.hasPrefix("CONFIRM:") else {
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "confirm.phrase must be 'CONFIRM' or 'CONFIRM:<requestId>'")
            }
        }

        // 步骤 2: 检查 Accessibility 权限
        guard AXIsProcessTrusted() else {
            return JSONRPC.error(id: id, code: BridgeError.permissionMissing.code, message: "Accessibility permission required")
        }

        // 步骤 3: 消费 token（仅在权限通过后）
        if let token = confirm["token"] as? String {
            guard server.consumeToken(token: token) else {
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Failed to consume token")
            }
        }

        // 解析 meta
        guard let meta = params["meta"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing meta")
        }

        guard let workspacePath = meta["workspacePath"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing workspacePath")
        }

        // 解析 target
        guard let target = params["target"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing target")
        }

        // 获取目标元素（优先 elementRef，fallback 到 selector）
        var targetElement: AXUIElement?
        var targetDescription = ""

        if let elementRef = target["elementRef"] as? [String: Any] {
            // TODO T8.1: 实现通过 elementId 查找元素的逻辑
            // P0 先返回错误，提示使用 selector
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "elementRef lookup not implemented, use selector instead")
        } else if let selector = target["selector"] as? [String: Any] {
            // 使用 selector 查找元素（复用 find 逻辑）
            guard let found = findElementBySelector(selector, limit: 1) else {
                return JSONRPC.error(id: id, code: BridgeError.elementNotFound.code, message: "Element not found by selector")
            }
            targetElement = found.element
            targetDescription = found.description
        } else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "target must contain elementRef or selector")
        }

        guard let element = targetElement else {
            return JSONRPC.error(id: id, code: BridgeError.elementNotFound.code, message: "Failed to resolve target element")
        }

        // 检查是否被中止
        if server.isRequestAborted(id) {
            return JSONRPC.error(id: id, code: BridgeError.aborted.code, message: "Request was aborted")
        }

        // 执行 AXPress 动作
        let result = AXUIElementPerformAction(element, kAXPressAction as CFString)

        if result != .success {
            let errorMessage = "AXPress failed: \(result.rawValue)"
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: errorMessage)
        }

        // 创建证据目录（可选，P0 最小化）
        let executionId = UUID().uuidString
        let evidenceDir = "\(workspacePath)/artifacts/desktop/\(Date().yyyyMMdd)/\(executionId)"
        try? FileManager.default.createDirectory(atPath: evidenceDir, withIntermediateDirectories: true)

        let responseData: [String: Any] = [
            "executionId": executionId,
            "clicked": true,
            "target": targetDescription,
            "evidence": [
                "dir": evidenceDir
            ]
        ]

        return JSONRPC.success(id: id, result: responseData)
    }

    /// desktop.typeText: 输入文本（T8.2）
    private func handleTypeText(id: String, params: [String: Any], peer: PeerIdentity) -> String {
        // T8.6: confirm gate 验证（token 优先，phrase 回退）
        guard let confirm = params["confirm"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Missing confirm object")
        }

        // 步骤 1: 验证 token（不消费）
        if let token = confirm["token"] as? String {
            let validationResult = server.validateToken(
                token: token,
                method: "desktop.typeText",
                params: params,
                peer: peer
            )
            switch validationResult {
            case .success:
                break  // token 有效，继续检查权限
            case .invalid:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Invalid token")
            case .used:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token already used")
            case .expired:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token expired")
            case .mismatch:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token scope mismatch")
            }
        } else if let phrase = confirm["phrase"] as? String {
            // 回退到 phrase 验证（兼容 T8）
            guard phrase == "CONFIRM" || phrase.hasPrefix("CONFIRM:") else {
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "confirm.phrase must be 'CONFIRM' or 'CONFIRM:<requestId>'")
            }
        } else {
            return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "confirm.token or confirm.phrase required")
        }

        // 步骤 2: 检查 Accessibility 权限
        guard AXIsProcessTrusted() else {
            return JSONRPC.error(id: id, code: BridgeError.permissionMissing.code, message: "Accessibility permission required")
        }

        // 步骤 3: 消费 token（仅在权限通过后）
        if let token = confirm["token"] as? String {
            guard server.consumeToken(token: token) else {
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Failed to consume token")
            }
        }

        // 解析 meta
        guard let meta = params["meta"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing meta")
        }

        guard let workspacePath = meta["workspacePath"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing workspacePath")
        }

        // 解析 text
        guard let text = params["text"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing text")
        }

        // 解析 target（可选）
        var targetElement: AXUIElement? = nil
        if let target = params["target"] as? [String: Any] {
            if let selector = target["selector"] as? [String: Any] {
                if let found = findElementBySelector(selector, limit: 1) {
                    targetElement = found.element
                    // 尝试聚焦
                    if let element = targetElement {
                        _ = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
                    }
                }
            }
        }

        // P0 稳定方案：剪贴板粘贴
        // 1. 写入剪贴板
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)

        // 2. 调用 hotkey cmd+v
        sendHotkey(keys: ["cmd", "v"])

        // 创建证据目录
        let executionId = UUID().uuidString
        let evidenceDir = "\(workspacePath)/artifacts/desktop/\(Date().yyyyMMdd)/\(executionId)"
        try? FileManager.default.createDirectory(atPath: evidenceDir, withIntermediateDirectories: true)

        let responseData: [String: Any] = [
            "executionId": executionId,
            "typed": true,
            "textLength": text.count,
            "method": "clipboard+paste",
            "evidence": [
                "dir": evidenceDir
            ]
        ]

        return JSONRPC.success(id: id, result: responseData)
    }

    /// desktop.hotkey: 发送快捷键（T8.2）
    private func handleHotkey(id: String, params: [String: Any], peer: PeerIdentity) -> String {
        // T8.6: confirm gate 验证（token 优先，phrase 回退）
        guard let confirm = params["confirm"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Missing confirm object")
        }

        // 步骤 1: 验证 token（不消费）
        if let token = confirm["token"] as? String {
            let validationResult = server.validateToken(
                token: token,
                method: "desktop.hotkey",
                params: params,
                peer: peer
            )
            switch validationResult {
            case .success:
                break  // token 有效，继续检查权限
            case .invalid:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Invalid token")
            case .used:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token already used")
            case .expired:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token expired")
            case .mismatch:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token scope mismatch")
            }
        } else if let phrase = confirm["phrase"] as? String {
            // 回退到 phrase 验证（兼容 T8）
            guard phrase == "CONFIRM" || phrase.hasPrefix("CONFIRM:") else {
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "confirm.phrase must be 'CONFIRM' or 'CONFIRM:<requestId>'")
            }
        } else {
            return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "confirm.token or confirm.phrase required")
        }

        // 步骤 2: 检查 Accessibility 权限
        guard AXIsProcessTrusted() else {
            return JSONRPC.error(id: id, code: BridgeError.permissionMissing.code, message: "Accessibility permission required")
        }

        // 步骤 3: 消费 token（仅在权限通过后）
        if let token = confirm["token"] as? String {
            guard server.consumeToken(token: token) else {
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Failed to consume token")
            }
        }

        // 解析 meta
        guard let meta = params["meta"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing meta")
        }

        guard let workspacePath = meta["workspacePath"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing workspacePath")
        }

        // 解析 keys
        guard let keys = params["keys"] as? [String] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing keys")
        }

        // 发送快捷键
        sendHotkey(keys: keys)

        // 创建证据目录
        let executionId = UUID().uuidString
        let evidenceDir = "\(workspacePath)/artifacts/desktop/\(Date().yyyyMMdd)/\(executionId)"
        try? FileManager.default.createDirectory(atPath: evidenceDir, withIntermediateDirectories: true)

        let responseData: [String: Any] = [
            "executionId": executionId,
            "sent": true,
            "keys": keys,
            "evidence": [
                "dir": evidenceDir
            ]
        ]

        return JSONRPC.success(id: id, result: responseData)
    }

    /// desktop.waitUntil: 等待 UI 条件成立（T8.3）
    private func handleWaitUntil(id: String, params: [String: Any]) -> String {
        // 解析 meta
        guard let meta = params["meta"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing meta")
        }

        guard let workspacePath = meta["workspacePath"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing workspacePath")
        }

        // 解析 condition（T8 P0: 只支持 selectorExists）
        guard let condition = params["condition"] as? [String: Any],
              let selector = condition["selectorExists"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing condition.selectorExists")
        }

        // 解析 timeout 和 pollInterval
        let timeoutMs = params["timeoutMs"] as? Int ?? 15000
        let pollIntervalMs = params["pollMs"] as? Int ?? 500

        let startTime = Date()
        let deadline = startTime.addingTimeInterval(Double(timeoutMs) / 1000.0)

        // 轮询查找元素
        var matchedCount = 0
        var lastError: String? = nil

        while Date() < deadline {
            // 检查是否被中止
            if server.isRequestAborted(id) {
                return JSONRPC.error(id: id, code: BridgeError.aborted.code, message: "Request was aborted")
            }

            // 尝试查找元素
            if let found = findElementBySelector(selector, limit: 1) {
                let elapsedMs = Int(Date().timeIntervalSince(startTime) * 1000)

                // 创建证据目录
                let executionId = UUID().uuidString
                let evidenceDir = "\(workspacePath)/artifacts/desktop/\(Date().yyyyMMdd)/\(executionId)"
                try? FileManager.default.createDirectory(atPath: evidenceDir, withIntermediateDirectories: true)

                let responseData: [String: Any] = [
                    "executionId": executionId,
                    "satisfied": true,
                    "matched": 1,
                    "elapsedMs": elapsedMs,
                    "evidence": [
                        "dir": evidenceDir
                    ]
                ]

                return JSONRPC.success(id: id, result: responseData)
            }

            // 等待下次轮询
            Thread.sleep(forTimeInterval: Double(pollIntervalMs) / 1000.0)
        }

        // 超时
        let elapsedMs = Int(Date().timeIntervalSince(startTime) * 1000)
        return JSONRPC.error(id: id, code: BridgeError.timeout.code, message: "Timeout after \(elapsedMs)ms")
    }

    /// desktop.abort: 中止指定请求（T8.3）
    private func handleAbort(id: String, params: [String: Any]) -> String {
        // 解析 targetRequestId
        guard let targetRequestId = params["targetRequestId"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing targetRequestId")
        }

        // 标记请求为已中止
        let wasAborted = server.abortRequest(targetRequestId)

        let responseData: [String: Any] = [
            "aborted": true,
            "targetRequestId": targetRequestId,
            "wasPresent": wasAborted
        ]

        return JSONRPC.success(id: id, result: responseData)
    }

    // MARK: - T8.2 辅助函数

    /// 通过 selector 查找元素（返回第一个匹配）
    private func findElementBySelector(_ selector: [String: Any], limit: Int) -> (element: AXUIElement, description: String)? {
        // 检查 Accessibility 权限
        guard AXIsProcessTrusted() else { return nil }

        // 获取 frontmost root
        var rootElement: AXUIElement?
        if #available(macOS 14.0, *) {
            if let app = NSWorkspace.shared.frontmostApplication {
                rootElement = AXUIElementCreateApplication(app.processIdentifier)
            }
        }
        if rootElement == nil {
            rootElement = AXUIElementCreateSystemWide()
        }

        guard let root = rootElement else { return nil }

        // 解析 selector
        let byRole = selector["byRole"] as? String
        let titleContains = selector["titleContains"] as? String
        let valueContains = selector["valueContains"] as? String

        // 遍历查找
        var found: (element: AXUIElement, description: String)? = nil

        func traverse(_ element: AXUIElement, depth: Int) {
            guard found == nil, depth < 20 else { return }

            let role = copyAXValue(element, attribute: kAXRoleAttribute) as? String
            let title = copyAXValue(element, attribute: kAXTitleAttribute) as? String
            let value = copyAXValue(element, attribute: kAXValueAttribute)

            // 应用 selector 过滤
            var matches = true
            if let byRole = byRole, role != byRole { matches = false }
            if let titleContains = titleContains {
                if let t = title, !t.contains(titleContains) { matches = false }
                else if title == nil { matches = false }
            }
            if let valueContains = valueContains {
                if let v = value as? String, !v.contains(valueContains) { matches = false }
                else if !(value is String) { matches = false }
            }

            if matches {
                var desc = role ?? "Unknown"
                if let t = title { desc += "('\(t)')" }
                found = (element, desc)
                return
            }

            // 递归子元素
            if let children = copyAXValue(element, attribute: kAXChildrenAttribute) as? [AXUIElement] {
                for child in children {
                    traverse(child, depth: depth + 1)
                    if found != nil { break }
                }
            }
        }

        traverse(root, depth: 0)
        return found
    }

    /// 发送快捷键组合
    private func sendHotkey(keys: [String]) {
        // CGEventKeyCode 映射
        let keyMap: [String: CGKeyCode] = [
            "cmd": 0x37,      // kVK_Command
            "v": 0x09,        // kVK_ANSI_V
            "enter": 0x24,    // kVK_Return
            "c": 0x08,        // kVK_ANSI_C
            "a": 0x00,        // kVK_ANSI_A
            "x": 0x07,        // kVK_ANSI_X
            "z": 0x06,        // kVK_ANSI_Z
            "shift": 0x38,    // kVK_Shift
            "option": 0x3A,   // kVK_Option
            "control": 0x3B   // kVK_Control
        ]

        // 分离修饰键和普通键
        var modifiers: [CGKeyCode] = []
        var normalKey: CGKeyCode? = nil

        for key in keys {
            if let code = keyMap[key.lowercased()] {
                if ["cmd", "shift", "option", "control"].contains(key.lowercased()) {
                    modifiers.append(code)
                } else {
                    normalKey = code
                }
            }
        }

        guard let key = normalKey else {
            logger.error("No valid key found in: \(keys)")
            return
        }

        // 创建事件源
        guard let source = CGEventSource(stateID: .combinedSessionState) else {
            logger.error("Failed to create event source")
            return
        }

        // 按下修饰键
        for modifier in modifiers {
            let eventDown = CGEvent(keyboardEventSource: source, virtualKey: modifier, keyDown: true)
            eventDown?.flags = .maskCommand
            eventDown?.post(tap: .cghidEventTap)
        }

        // 按下/释放普通键
        let keyDown = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: true)
        keyDown?.flags = .maskCommand
        keyDown?.post(tap: .cghidEventTap)

        let keyUp = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: false)
        keyUp?.flags = .maskCommand
        keyUp?.post(tap: .cghidEventTap)

        // 释放修饰键
        for modifier in modifiers.reversed() {
            let eventUp = CGEvent(keyboardEventSource: source, virtualKey: modifier, keyDown: false)
            eventUp?.flags = .maskCommand
            eventUp?.post(tap: .cghidEventTap)
        }
    }

    // MARK: - T7.0 辅助函数

    /// 截取屏幕截图（T7.0）
    private func captureScreenshot(to evidenceDir: String) -> Bool {
        // 检查 Screen Recording 权限
        guard CGPreflightScreenCaptureAccess() else {
            logger.log("Screen Recording permission denied")
            return false
        }

        // 获取主显示器 ID
        let displayId = CGMainDisplayID()

        // 截取屏幕图像
        guard let image = CGDisplayCreateImage(displayId) else {
            logger.log("Failed to capture display image")
            return false
        }

        // 转换为 NSImage
        let nsImage = NSImage(cgImage: image, size: NSZeroSize)

        // 转换为 PNG Data
        guard let tiffData = nsImage.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiffData),
              let pngData = bitmap.representation(using: .png, properties: [:]) else {
            logger.log("Failed to convert screenshot to PNG")
            return false
        }

        let screenshotPath = "\(evidenceDir)/observe.png"
        do {
            try pngData.write(to: URL(fileURLWithPath: screenshotPath))
            logger.log("Screenshot saved to: \(screenshotPath)")
            return true
        } catch {
            logger.error("Failed to save screenshot: \(error)")
            return false
        }
    }

    /// 序列化 AX 树为 JSON（T7.1：有界遍历）
    private func serializeAXTree(to evidenceDir: String) -> [String: Any]? {
        // 检查 Accessibility 权限
        guard AXIsProcessTrusted() else {
            logger.log("Accessibility permission denied")
            return nil
        }

        // T7.A4: 获取前台应用作为根元素（替代 systemWide）
        var frontmostApp: [String: Any]?
        var rootElement: AXUIElement?

        // 方法 1: 通过 NSWorkspace 获取前台应用
        if #available(macOS 14.0, *) {
            let workspace = NSWorkspace.shared
            if let app = workspace.frontmostApplication {
                frontmostApp = [
                    "bundleId": app.bundleIdentifier ?? "",
                    "pid": app.processIdentifier
                ]
                logger.log("Frontmost app: \(app.bundleIdentifier ?? "unknown") (pid: \(app.processIdentifier))")

                // 创建应用级 AX 元素
                let appElement = AXUIElementCreateApplication(app.processIdentifier)
                rootElement = appElement
            }
        }

        // 兜底：如果无法获取前台应用，使用 systemWide
        if rootElement == nil {
            logger.log("Failed to get frontmost app, falling back to systemWide")
            rootElement = AXUIElementCreateSystemWide()
        }

        guard let unwrappedRootElement = rootElement else {
            logger.error("Failed to create root element")
            return nil
        }

        // T7.1: 遍历边界配置（统一限制参数）
        let maxDepth = 50
        let maxNodes = 5000
        let childLimit = 50
        let wallClockTimeoutMs = 10000

        let startTime = Date()
        let deadline = startTime.addingTimeInterval(Double(wallClockTimeoutMs) / 1000.0)

        // 遍历状态
        var traversal = AXTraversal(
            nodesVisited: 0,
            maxDepth: 0,
            truncated: false,
            startTime: startTime,
            timeoutMs: wallClockTimeoutMs,
            maxNodes: maxNodes
        )

        // 确定根节点角色
        let rootRole = (frontmostApp != nil) ? "Application" : "System"

        // 序列化 AX 树（有界遍历）
        let tree = serializeAXElement(
            unwrappedRootElement,
            role: rootRole,
            depth: 0,
            maxDepth: maxDepth,
            maxNodes: maxNodes,
            childLimit: childLimit,
            deadline: deadline,
            traversal: &traversal
        )

        // 计算遍历元数据
        let endTime = Date()
        let elapsedMs = Int(endTime.timeIntervalSince(startTime) * 1000)

        var result: [String: Any] = [:]

        if let treeData = tree {
            result["tree"] = treeData
        }

        // 添加前台应用信息
        if let frontmost = frontmostApp {
            result["frontmost"] = frontmost
        }

        // T7.1: 写入 traversal 元数据（统一限制参数）
        result["traversal"] = [
            "nodesVisited": traversal.nodesVisited,
            "depth": traversal.maxDepth,
            "elapsedMs": elapsedMs,
            "truncated": traversal.truncated,
            "limits": [
                "maxDepth": maxDepth,
                "maxNodes": maxNodes,
                "childLimit": childLimit,
                "timeoutMs": wallClockTimeoutMs
            ]
        ]

        // T7.0: 写入 ax.json 到证据目录
        let axPath = "\(evidenceDir)/ax.json"
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: result, options: .prettyPrinted)
            try jsonData.write(to: URL(fileURLWithPath: axPath))
            logger.log("AX tree written to: \(axPath)")
        } catch {
            logger.error("Failed to write ax.json: \(error)")
            return nil
        }

        return result
    }
}

// MARK: - T7.1 AX 遍历状态

/// AX 遍历状态（可变，通过引用传递）
struct AXTraversal {
    var nodesVisited: Int
    var maxDepth: Int
    var truncated: Bool
    let startTime: Date
    let timeoutMs: Int
    let maxNodes: Int

    /// 检查是否超时
    func isTimeout() -> Bool {
        let elapsed = Date().timeIntervalSince(startTime)
        return elapsed * 1000 >= Double(timeoutMs)
    }

    /// 检查是否达到节点限制
    func isNodeLimit() -> Bool {
        return nodesVisited >= maxNodes
    }

    /// 记录节点访问
    mutating func visitNode() -> Bool {
        nodesVisited += 1
        return !isTimeout() && !isNodeLimit()
    }

    /// 更新最大深度
    mutating func updateDepth(_ depth: Int) {
        if depth > maxDepth {
            maxDepth = depth
        }
    }

    /// 标记截断
    mutating func markTruncated() {
        truncated = true
    }
}

// MARK: - AX 元素序列化（T7.1：有界遍历）

/// 递归序列化 AX 元素（内置到 HostApp）
private func serializeAXElement(
    _ element: AXUIElement,
    role: String,
    depth: Int,
    maxDepth: Int,
    maxNodes: Int,
    childLimit: Int,
    deadline: Date,
    traversal: inout AXTraversal
) -> [String: Any]? {
    // T7.1: 检查边界条件
    guard depth < maxDepth else {
        return ["role": role, "error": "max_depth_exceeded"]
    }

    // 检查是否超时或达到节点限制
    guard !traversal.isTimeout() else {
        traversal.markTruncated()
        return ["role": role, "error": "timeout"]
    }

    guard !traversal.isNodeLimit() else {
        traversal.markTruncated()
        return ["role": role, "error": "max_nodes_exceeded"]
    }

    // 记录节点访问
    guard traversal.visitNode() else {
        traversal.markTruncated()
        return ["role": role, "error": "limit_exceeded"]
    }

    // 更新最大深度
    traversal.updateDepth(depth)

    var result: [String: Any] = ["role": role]

    // 提取常用属性
    let commonAttrs: [(String, String)] = [
        ("AXTitle", kAXTitleAttribute),
        ("AXValue", kAXValueAttribute),
        ("AXPlaceholderValue", kAXPlaceholderValueAttribute),
        ("AXHelp", kAXHelpAttribute),
        ("AXDescription", kAXDescriptionAttribute),
        ("AXRoleDescription", kAXRoleDescriptionAttribute)
    ]

    for (key, attr) in commonAttrs {
        if let value = copyAXValue(element, attribute: attr) {
            result[key] = value
        }
    }

    // 提取位置和大小
    if let position = copyAXValue(element, attribute: kAXPositionAttribute) as? [String: Any],
       let size = copyAXValue(element, attribute: kAXSizeAttribute) as? [String: Any] {
        result["frame"] = ["position": position, "size": size]
    }

    // T7.1: 提取子元素（有界遍历）
    if depth < 20 {
        var children: [[String: Any]] = []

        if let childrenValue = copyAXValue(element, attribute: kAXChildrenAttribute) as? [Any] {
            // 限制子元素数量（childLimit）
            let limit = min(childrenValue.count, childLimit)

            for i in 0..<limit {
                // 每处理一个子元素前检查边界
                if traversal.isTimeout() || traversal.isNodeLimit() {
                    traversal.markTruncated()
                    result["truncatedChildren"] = true
                    break
                }

                let child = childrenValue[i]
                let childElement = unsafeBitCast(child as CFTypeRef, to: AXUIElement.self)

                if let childRole = copyAXValue(childElement, attribute: kAXRoleAttribute) as? String {
                    if let childTree = serializeAXElement(
                        childElement,
                        role: childRole,
                        depth: depth + 1,
                        maxDepth: maxDepth,
                        maxNodes: maxNodes,
                        childLimit: childLimit,
                        deadline: deadline,
                        traversal: &traversal
                    ) {
                        children.append(childTree)
                    }
                }
            }

            // 记录截断的子元素数量
            if childrenValue.count > limit {
                result["truncatedChildrenCount"] = childrenValue.count - limit
            }

            if !children.isEmpty {
                result["children"] = children
            }
        }
    }

    return result
}

/// 复制 AX 属性值（内置到 HostApp）
private func copyAXValue(_ element: AXUIElement, attribute: String) -> Any? {
    var value: AnyObject?
    let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

    guard error == .success else {
        return nil
    }

    guard let unwrappedValue = value else {
        return nil
    }

    // 直接将 value 转换为 Swift 原生类型
    if let str = unwrappedValue as? String { return str }
    if let num = unwrappedValue as? Int { return num }
    if let num = unwrappedValue as? Double { return num }
    if let bool = unwrappedValue as? Bool { return bool }
    if let dict = unwrappedValue as? [String: Any] { return dict }

    // AX 特殊处理：CFArray 转换
    if CFGetTypeID(unwrappedValue as CFTypeRef) == CFArrayGetTypeID() {
        let cfArray = unwrappedValue as! CFArray
        var result: [Any] = []
        let count = CFArrayGetCount(cfArray)
        for i in 0..<count {
            if let item = CFArrayGetValueAtIndex(cfArray, i) {
                // AXUIElement 需要特殊处理
                let axElement = unsafeBitCast(item, to: AXUIElement.self)
                result.append(axElement)
            }
        }
        return result
    }

    // AX 特殊处理：AXValue 转换（position/size）
    if CFGetTypeID(unwrappedValue as CFTypeRef) == AXValueGetTypeID() {
        let axValue = unwrappedValue as! AXValue
        let type = AXValueGetType(axValue)

        switch type {
        case .cgPoint:
            var point = CGPoint.zero
            if AXValueGetValue(axValue, .cgPoint, &point) {
                return ["x": Int(point.x), "y": Int(point.y)]
            }
        case .cgSize:
            var size = CGSize.zero
            if AXValueGetValue(axValue, .cgSize, &size) {
                return ["width": Int(size.width), "height": Int(size.height)]
            }
        case .cgRect:
            var rect = CGRect.zero
            if AXValueGetValue(axValue, .cgRect, &rect) {
                return [
                    "x": Int(rect.origin.x),
                    "y": Int(rect.origin.y),
                    "width": Int(rect.size.width),
                    "height": Int(rect.size.height)
                ]
            }
        default:
            break
        }
    }

    // 兜底：返回字符串表示
    return String(describing: unwrappedValue)
}
