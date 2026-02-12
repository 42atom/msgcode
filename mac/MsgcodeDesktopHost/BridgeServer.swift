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
import Carbon.HIToolbox  // 提供 kVK_* 常量

// MARK: - Data Extension for SHA256

extension Data {
    /// 计算 SHA256 哈希
    func sha256() -> Data {
        return Data(SHA256.hash(data: self))
    }
}

// MARK: - Event Writer（T10）

/// 事件写入器：NDJSON 格式写入 events.ndjson
/// 线程安全：使用串行队列保证写入顺序
class EventWriter {
    private let logger = Logger(subsystem: "com.msgcode.desktop.host", category: "EventWriter")
    private let fileHandle: FileHandle
    private let queue: DispatchQueue
    private let evidenceDir: String

    /// 初始化事件写入器
    /// - Parameter evidenceDir: 证据目录路径
    init?(evidenceDir: String) {
        self.evidenceDir = evidenceDir
        self.queue = DispatchQueue(label: "com.msgcode.desktop.host.eventwriter", qos: .utility)

        let eventsPath = "\(evidenceDir)/events.ndjson"

        // 创建文件（若不存在）
        FileManager.default.createFile(atPath: eventsPath, contents: nil)

        guard let handle = try? FileHandle(forWritingTo: URL(fileURLWithPath: eventsPath)) else {
            return nil
        }

        self.fileHandle = handle
    }

    /// 写入事件（NDJSON 单行 JSON）
    /// - Parameter event: 事件字典
    func write(_ event: [String: Any]) {
        queue.async { [weak self] in
            guard let self = self else { return }

            do {
                let jsonData = try JSONSerialization.data(withJSONObject: event, options: [])
                let line = jsonData + Data([0x0A])  // 添加换行符

                self.fileHandle.write(line)
                self.fileHandle.synchronizeFile()  // 立即落盘
            } catch {
                self.logger.error("Failed to write event: \(error)")
            }
        }
    }

    /// 关闭写入器
    func close() {
        queue.sync { [weak self] in
            self?.fileHandle.closeFile()
        }
    }

    deinit {
        close()
    }
}

// MARK: - RunTree Index（T12）

/// RunTree 索引写入器：NDJSON 格式写入 index.ndjson
/// 线程安全：使用串行队列保证写入顺序
class RunTreeIndex {
    private let logger = Logger(subsystem: "com.msgcode.desktop.host", category: "RunTreeIndex")
    private let fileHandle: FileHandle
    private let queue: DispatchQueue
    private let workspacePath: String

    /// 初始化 RunTree 索引写入器
    /// - Parameter workspacePath: 工作区路径
    init?(workspacePath: String) {
        self.workspacePath = workspacePath
        self.queue = DispatchQueue(label: "com.msgcode.desktop.host.runtree", qos: .utility)

        // 创建 desktop 目录
        let desktopDir = "\(workspacePath)/artifacts/desktop"
        try? FileManager.default.createDirectory(atPath: desktopDir, withIntermediateDirectories: true)

        let indexPath = "\(desktopDir)/index.ndjson"

        // 创建文件（若不存在）
        FileManager.default.createFile(atPath: indexPath, contents: nil)

        guard let handle = try? FileHandle(forWritingTo: URL(fileURLWithPath: indexPath)) else {
            return nil
        }

        // 追加到文件末尾
        if let attrs = try? FileManager.default.attributesOfItem(atPath: indexPath) as [FileAttributeKey: Any],
           let fileSize = attrs[.size] as? UInt64, fileSize > 0 {
            try? handle.seek(toOffset: fileSize)
        }

        self.fileHandle = handle
    }

    /// 写入执行记录（NDJSON 单行 JSON）
    /// - Parameters:
    ///   - executionId: 执行 ID
    ///   - requestId: 请求 ID
    ///   - method: 方法名
    ///   - ok: 是否成功
    ///   - errorCode: 错误码（可选）
    ///   - evidenceDir: 证据目录
    func append(
        executionId: String,
        requestId: String,
        method: String,
        ok: Bool,
        errorCode: String? = nil,
        evidenceDir: String
    ) {
        queue.async { [weak self] in
            guard let self = self else { return }

            // ISO 8601 时间戳
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            let timestamp = formatter.string(from: Date())

            // 计算相对路径（相对于 workspacePath）
            let relativeEvidenceDir = evidenceDir.replacingOccurrences(of: self.workspacePath + "/", with: "")

            var record: [String: Any] = [
                "ts": timestamp,
                "executionId": executionId,
                "requestId": requestId,
                "method": method,
                "ok": ok,
                "evidenceDir": relativeEvidenceDir,
                "eventsPath": "events.ndjson"
            ]

            if let code = errorCode {
                record["errorCode"] = code
            }

            do {
                let jsonData = try JSONSerialization.data(withJSONObject: record, options: [])
                let line = jsonData + Data([0x0A])  // 添加换行符

                self.fileHandle.write(line)
                self.fileHandle.synchronizeFile()  // 立即落盘
            } catch {
                self.logger.error("Failed to write RunTree index: \(error)")
            }
        }
    }

    /// 关闭写入器
    func close() {
        queue.sync { [weak self] in
            self?.fileHandle.closeFile()
        }
    }

    deinit {
        close()
    }
}

// MARK: - Event Types（T10）

/// 事件类型枚举
enum EventType: String {
    case start = "desktop.start"
    case stop = "desktop.stop"
    case error = "desktop.error"
    case observe = "desktop.observe"  // T10: observe 专用事件
}

/// 构建事件字典
struct Event {
    /// 构建 start 事件
    static func start(
        executionId: String,
        method: String,
        params: [String: Any]? = nil
    ) -> [String: Any] {
        var event: [String: Any] = [
            "type": EventType.start.rawValue,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "executionId": executionId,
            "method": method
        ]
        if let params = params {
            event["params"] = params
        }
        return event
    }

    /// 构建 stop 事件
    static func stop(
        executionId: String,
        method: String,
        result: [String: Any]? = nil
    ) -> [String: Any] {
        var event: [String: Any] = [
            "type": EventType.stop.rawValue,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "executionId": executionId,
            "method": method
        ]
        if let result = result {
            event["result"] = result
        }
        return event
    }

    /// 构建 error 事件
    static func error(
        executionId: String,
        method: String,
        errorCode: String,
        errorMessage: String
    ) -> [String: Any] {
        return [
            "type": EventType.error.rawValue,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "executionId": executionId,
            "method": method,
            "error": [
                "code": errorCode,
                "message": errorMessage
            ]
        ]
    }

    /// 构建 observe 事件（T10）
    static func observe(
        executionId: String,
        permissionsMissing: [String]? = nil,
        screenshotPath: String? = nil,
        axPath: String? = nil,
        envPath: String? = nil
    ) -> [String: Any] {
        var event: [String: Any] = [
            "type": EventType.observe.rawValue,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "executionId": executionId
        ]
        if let perms = permissionsMissing, !perms.isEmpty {
            event["permissionsMissing"] = perms
        }
        if let sp = screenshotPath {
            event["screenshotPath"] = sp
        }
        if let ap = axPath {
            event["axPath"] = ap
        }
        if let ep = envPath {
            event["envPath"] = ep
        }
        return event
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
    private var consumedTokens: Set<String> = []  // 已消费 token（用于区分 reuse vs invalid）
    private let tokensLock = NSLock()  // 保护 issuedTokens/consumedTokens 的线程安全

    /// 每个 method 参与 digest 计算的核心参数 key（allowlist）
    /// 显式排除 meta/confirm：只有列出的 key 参与 digest
    private static let digestKeysByMethod: [String: [String]] = [
        "desktop.click":     ["target"],
        "desktop.typeText":  ["target", "text"],
        "desktop.hotkey":    ["keys"],
        "desktop.waitUntil": ["condition"],
    ]
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
        case mismatch(details: [String: Any])
    }

    /// desktop.confirm.issue: 签发一次性确认令牌
    internal func handleConfirmIssue(id: String, params: [String: Any], peer: PeerIdentity) -> String {
        NSLog("=== handleConfirmIssue called ===")
        NSLog("id: \(id), peer: \(peer.auditTokenDigest)")

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

        // 计算 paramsDigest（统一入口：issue 和 validate 调用同一函数）
        let (paramsDigest, _) = computeScopeDigest(method: method, fullParams: intentParams)

        // 生成 token
        let token = UUID().uuidString

        // 创建 TokenRecord
        let scope = TokenScope(method: method, paramsDigest: paramsDigest)
        let tokenPeer = TokenPeer(auditTokenDigest: peer.auditTokenDigest, pid: peer.pid)
        let record = TokenRecord(token: token, expiresAt: expiresAt, scope: scope, peer: tokenPeer, used: false)

        // 存储到 token store
        tokensLock.lock()
        issuedTokens[token] = record
        let allTokensAfter = Array(issuedTokens.keys).joined(separator: ", ")
        tokensLock.unlock()

        // 调试：使用 NSLog 输出（避免文件权限问题）
        NSLog("=== TOKEN ISSUE ===")
        NSLog("Token: \(token)")
        NSLog("Peer: \(peer.auditTokenDigest) (pid: \(peer.pid))")
        NSLog("Method: \(method)")
        NSLog("Digest: \(paramsDigest)")
        NSLog("All tokens after issue: [\(allTokensAfter)]")

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

        // 检查是否已消费（reuse）
        if consumedTokens.contains(token) {
            logger.info("Token reuse detected: \(token.prefix(8))...")
            return .used
        }

        guard let record = issuedTokens[token] else {
            logger.error("Token not found: \(token.prefix(8))...")
            return .invalid
        }

        // 检查是否过期
        if Date() > record.expiresAt {
            return .expired
        }

        // peer 绑定：降级为审计日志（不拒绝）
        // 原因：desktopctl 是 CLI 代理，每次调用是独立进程，auditTokenDigest 必然不同
        // 安全由 method + paramsDigest + ttl + single-use 保障
        if record.peer.auditTokenDigest != "internal" && record.peer.auditTokenDigest != peer.auditTokenDigest {
            logger.info("Peer differs (audit only): token=\(record.peer.auditTokenDigest), request=\(peer.auditTokenDigest)")
        }

        // 检查 method 绑定
        NSLog("Method check: record.method=\(record.scope.method), request.method=\(method)")
        if record.scope.method != method {
            NSLog("Method MISMATCH!")
            return .mismatch(details: [
                "expectedMethod": record.scope.method,
                "actualMethod": method,
                "reason": "method_mismatch",
            ])
        }

        // 检查 paramsDigest（统一入口：与 handleConfirmIssue 调用同一函数）
        NSLog("Digest check starts...")
        let (computedDigest, digestKeys) = computeScopeDigest(method: method, fullParams: params)

        if record.scope.paramsDigest != computedDigest {
            logger.error("Digest mismatch: expected=\(record.scope.paramsDigest), actual=\(computedDigest), keys=\(digestKeys)")
            return .mismatch(details: [
                "expectedDigest": record.scope.paramsDigest,
                "actualDigest": computedDigest,
                "method": method,
                "digestKeys": digestKeys,
            ])
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

        // 移入 consumed 集合（保留痕迹，用于 reuse 检测）
        consumedTokens.insert(token)
        issuedTokens.removeValue(forKey: token)

        return true
    }

    // MARK: - Token Digest 统一入口

    /// 统一 digest 入口：handleConfirmIssue 和 validateToken 必须调用同一函数
    ///
    /// 策略：allowlist（只取核心 action 参数），显式排除 meta/confirm
    ///
    /// - Parameters:
    ///   - method: 目标 RPC 方法名（非 confirm.issue）
    ///   - fullParams: 完整请求参数
    /// - Returns: (digest: SHA256 前 16 hex, keys: 参与计算的 key 列表)
    private func computeScopeDigest(method: String, fullParams: [String: Any]) -> (digest: String, keys: [String]) {
        var actionParams: [String: Any] = [:]
        let usedKeys: [String]

        if let allowedKeys = BridgeServer.digestKeysByMethod[method] {
            // 白名单模式：只提取核心 action 参数
            for key in allowedKeys {
                if let value = fullParams[key] {
                    actionParams[key] = value
                }
            }
            usedKeys = allowedKeys.sorted()
        } else {
            // 兜底：排除 meta/confirm（未知方法）
            actionParams = fullParams
            actionParams.removeValue(forKey: "meta")
            actionParams.removeValue(forKey: "confirm")
            usedKeys = actionParams.keys.sorted()
        }

        // canonical JSON + SHA256 前 16 hex
        guard let jsonData = try? JSONSerialization.data(withJSONObject: actionParams, options: [.sortedKeys]) else {
            return ("INVALID_JSON", usedKeys)
        }
        let hash = jsonData.sha256()
        let hex = hash.map { String(format: "%02x", $0) }.joined()
        return (String(hex.prefix(16)), usedKeys)
    }

    // MARK: - T9.M0.1: JSON-RPC 可复用入口（进程内直接调用）

    /// 处理 JSON-RPC 请求（同步，用于进程内直接调用）
    /// - Parameters:
    ///   - requestJson: JSON-RPC 2.0 请求字符串
    ///   - peer: 调用者身份信息（进程内调用可传入 nil，使用当前进程）
    /// - Returns: JSON-RPC 2.0 响应字符串
    /// 处理 JSON-RPC 请求（同步，用于进程内直接调用）
    /// - Parameters:
    ///   - requestJson: JSON-RPC 2.0 请求字符串
    ///   - peer: 调用者身份信息（进程内调用传入 nil）
    /// - Returns: JSON-RPC 2.0 响应字符串
    func handleJsonRpc(requestJson: String, peer: PeerIdentity? = nil) -> String {
        // 解析 JSON-RPC 请求
        guard let (id, method, params) = JSONRPC.parseRequest(requestJson) else {
            return JSONRPC.error(id: "", code: BridgeError.invalidRequest.code, message: "Invalid JSON-RPC request")
        }

        // 检查 service 是否停止
        guard isAccepting else {
            return JSONRPC.error(id: id, code: BridgeError.hostStopped.code, message: "Host is stopped")
        }

        // 注册请求
        registerRequest(id)

        // T9.M0.4: 直接传递 peer（可能为 nil，表示 internal 调用）
        let response = routeRequest(id: id, method: method, params: params, peer: peer)
        unregisterRequest(id)
        return response
    }

    /// 路由 JSON-RPC 请求到具体方法处理器（从 BridgeServerAdapter 提取）
    /// - Parameters:
    ///   - id: 请求 ID
    ///   - method: 方法名
    ///   - params: 参数字典
    ///   - peer: 调用者身份（nil 表示进程内 internal 调用）
    /// - Returns: JSON-RPC 响应字符串
    private func routeRequest(id: String, method: String, params: [String: Any], peer: PeerIdentity?) -> String {
        // T9.M0.4: allowlist 验证（需要 workspacePath）
        // T9.M0.4: 进程内调用（peer == nil）跳过 allowlist 验证（信任自己）
        // T9.M0.4: 外部调用（peer != nil）必须通过 allowlist 验证
        if let meta = params["meta"] as? [String: Any],
           let workspacePath = meta["workspacePath"] as? String {
            // 进程内调用跳过 allowlist 验证（信任自己）
            if let p = peer {
                // 外部调用：验证 allowlist
                if !validateAllowlist(workspacePath: workspacePath, callerPid: p.pid) {
                    return JSONRPC.error(id: id, code: BridgeError.callerNotAllowed.code, message: "Caller not allowed by allowlist")
                }
            }
        }

        // T9.M0.4: 如果 peer 是 nil，创建一个 synthetic peer 用于 handlers（需要 pid 等信息）
        let effectivePeer: PeerIdentity
        if let p = peer {
            effectivePeer = p
        } else {
            // 进程内调用：使用当前进程信息
            effectivePeer = PeerIdentity(
                pid: getpid(),
                auditTokenDigest: "internal",
                signingId: Bundle.main.bundleIdentifier,
                teamId: nil
            )
        }

        // 方法路由
        switch method {
        case "desktop.health":
            return handleHealth(id: id, params: params, peer: effectivePeer)
        case "desktop.doctor":
            return handleDoctor(id: id, params: params, peer: effectivePeer)
        case "desktop.observe":
            return handleObserve(id: id, params: params)
        case "desktop.find":
            return handleFind(id: id, params: params)
        case "desktop.click":
            return handleClick(id: id, params: params, peer: effectivePeer)
        case "desktop.typeText":
            return handleTypeText(id: id, params: params, peer: effectivePeer)
        case "desktop.hotkey":
            return handleHotkey(id: id, params: params, peer: effectivePeer)
        case "desktop.highlight":
            return handleHighlight(id: id, params: params)
        case "desktop.listModals":
            return handleListModals(id: id, params: params)
        case "desktop.dismissModal":
            return handleDismissModal(id: id, params: params)
        case "desktop.waitUntil":
            return handleWaitUntil(id: id, params: params)
        case "desktop.abort":
            return handleAbort(id: id, params: params)
        case "desktop.confirm.issue":
            return handleConfirmIssue(id: id, params: params, peer: effectivePeer)
        // T16.0.6: 测试专用 RPC（通过 TestHooksPolicy 统一控制）
        case "desktop._test.injectModalDetector", "desktop._test.clearModalDetector":
            // 使用统一策略检查测试钩子是否启用
            guard TestHooksPolicy.isEnabled(params: params) else {
                return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Unknown method: \(method)")
            }

            switch method {
            case "desktop._test.injectModalDetector":
                return handleTestInjectModalDetector(id: id, params: params)
            case "desktop._test.clearModalDetector":
                return handleTestClearModalDetector(id: id, params: params)
            default:
                return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Unknown method: \(method)")
            }
        default:
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Unknown method: \(method)")
        }
    }

    // MARK: - T5.1: Allowlist 验证（从 BridgeServerAdapter 提取）

    /// 验证 allowlist（T9.M0.3: 修复 stub，实现完整校验逻辑）
    /// - Parameter workspacePath: 工作区路径
    /// - Returns: true 允许，false 拒绝
    /// - Parameter callerPid: 调用者进程 ID（用于 pid:* 规则匹配）
    private func validateAllowlist(workspacePath: String, callerPid: pid_t) -> Bool {
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
            logger.log("Allowlist is empty, denying all callers (pid: \(callerPid))")
            return false
        }

        // 检查通配符
        if callers.contains("*") {
            logger.log("Allowlist wildcard *, allowing (pid: \(callerPid))")
            return true
        }

        // 检查 pid:* 规则
        for rule in callers {
            if rule.hasPrefix("pid:") {
                let ruleStr = String(rule.dropFirst(4))
                if let targetPid = pid_t(ruleStr) {
                    if callerPid == targetPid {
                        logger.log("Allowlist pid:\(targetPid) matched, allowing (pid: \(callerPid))")
                        return true
                    }
                }
            }
        }

        // 没有匹配规则：拒绝
        logger.log("Allowlist no matching rule, denying (pid: \(callerPid))")
        return false
    }

    // MARK: - 方法处理器（从 BridgeServerAdapter 提取）

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
            "peer": peerData
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

        // P0.5: 添加 peer 信息
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
            "peer": peerData
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

        // T10: 创建事件写入器
        guard let eventWriter = EventWriter(evidenceDir: evidenceDir) else {
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to create event writer")
        }

        // T10: 写入 start 事件
        eventWriter.write(Event.start(executionId: executionId, method: "desktop.observe"))

        // T12: 创建 RunTree 索引
        guard let runTreeIndex = RunTreeIndex(workspacePath: workspacePath) else {
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to create RunTree index")
        }

        // Host 信息
        let hostPid = ProcessInfo.processInfo.processIdentifier
        let hostBundleId = Bundle.main.bundleIdentifier ?? "com.msgcode.desktop.host"

        // 落盘 env.json（T10: 增加 eventsPath）
        let envPath = "\(evidenceDir)/env.json"
        let env: [String: Any] = [
            "host": [
                "pid": hostPid,
                "bundleId": hostBundleId
            ],
            "eventsPath": "events.ndjson"
        ]
        do {
            let envData = try JSONSerialization.data(withJSONObject: env, options: .prettyPrinted)
            try envData.write(to: URL(fileURLWithPath: envPath))
        } catch {
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to write env.json: \(error)")
        }

        // 检查权限
        var permissionsMissing: [String] = []
        let accessibility = AXIsProcessTrusted()
        let screenRecording = CGPreflightScreenCaptureAccess()

        if !accessibility {
            permissionsMissing.append("accessibility")
        }
        if !screenRecording {
            permissionsMissing.append("screenRecording")
        }

        // 检查是否有缺失权限
        if !permissionsMissing.isEmpty {
            eventWriter.write(Event.observe(executionId: executionId, permissionsMissing: permissionsMissing))
            eventWriter.write(Event.stop(executionId: executionId, method: "desktop.observe"))
            runTreeIndex.append(executionId: executionId, requestId: id, method: "desktop.observe", ok: true, evidenceDir: evidenceDir)

            let result: [String: Any] = [
                "executionId": executionId,
                "permissionsMissing": permissionsMissing,
                "evidence": [
                    "dir": evidenceDir,
                    "envPath": "env.json",
                    "eventsPath": "events.ndjson"
                ]
            ]
            return JSONRPC.success(id: id, result: result)
        }

        // 获取截图（如果有权限）
        var screenshotPath: String? = nil
        if screenRecording {
            if let screenshot = captureScreenshot() {
                screenshotPath = "\(evidenceDir)/screenshot.png"
                do {
                    try screenshot.write(to: URL(fileURLWithPath: screenshotPath!))
                } catch {
                    logger.error("Failed to write screenshot: \(error)")
                }
            }
        }

        // 获取 AX 树（如果有权限）
        var axPath: String? = nil
        if accessibility {
            if buildAXTree(evidenceDir: evidenceDir) != nil {
                axPath = "ax.json"
            }
        }

        // T10: 写入 observe 事件
        eventWriter.write(Event.observe(
            executionId: executionId,
            permissionsMissing: permissionsMissing.isEmpty ? nil : permissionsMissing,
            screenshotPath: screenshotPath,
            axPath: axPath,
            envPath: "env.json"
        ))

        // T10: 写入 stop 事件
        eventWriter.write(Event.stop(executionId: executionId, method: "desktop.observe"))

        // T12: 写入 RunTree 索引
        runTreeIndex.append(executionId: executionId, requestId: id, method: "desktop.observe", ok: true, evidenceDir: evidenceDir)

        // 构建返回结果
        var result: [String: Any] = [
            "executionId": executionId,
            "evidence": [
                "dir": evidenceDir,
                "envPath": "env.json",
                "eventsPath": "events.ndjson"
            ]
        ]

        if !permissionsMissing.isEmpty {
            result["permissionsMissing"] = permissionsMissing
        }

        if screenshotPath != nil {
            result["evidence"] = [
                "dir": evidenceDir,
                "screenshotPath": "screenshot.png",
                "axPath": axPath,
                "envPath": "env.json",
                "eventsPath": "events.ndjson"
            ]
        }

        return JSONRPC.success(id: id, result: result)
    }

    /// desktop.find: 查找 UI 元素
    // MARK: - T16.0: 辅助结构体（评分 + 候选元素）

    /// T16.0.3: 方向枚举
    private enum NearDirection: String {
        case above = "above"
        case below = "below"
        case left = "left"
        case right = "right"
    }

    /// 评分后的候选元素
    private struct ScoredElement {
        let element: AXUIElement
        let role: String?
        let title: String?
        let value: Any?
        let frame: [String: Int]?
        let score: Double
        let reasons: [String]
    }

    /// T16.0.3: 锚点元素信息
    private struct AnchorElement {
        let element: AXUIElement
        let frame: [String: Int]
        let fingerprint: String
    }

    /// T16.0.1: 检查元素 frame 是否与 rect 有交集（交集语义）
    private func isElementInRect(_ frame: [String: Int], rect: [String: Int]) -> Bool {
        let elemLeft = frame["x"] ?? 0
        let elemRight = elemLeft + (frame["width"] ?? 0)
        let elemTop = frame["y"] ?? 0
        let elemBottom = elemTop + (frame["height"] ?? 0)

        let rectLeft = rect["x"] ?? 0
        let rectRight = rectLeft + (rect["width"] ?? Int.max)
        let rectTop = rect["y"] ?? 0
        let rectBottom = rectTop + (rect["height"] ?? Int.max)

        // 交集语义：元素至少部分在 rect 内
        return elemRight > rectLeft && elemLeft < rectRight &&
               elemBottom > rectTop && elemTop < rectBottom
    }

    /// T16 修复: 硬匹配过滤（必须通过所有给定的 selector 条件）
    private func passesHardMatch(
        role: String?,
        title: String?,
        value: Any?,
        frame: [String: Int]?,
        selector: [String: Any]
    ) -> Bool {
        let selectorByRole = selector["byRole"] as? String
        let selectorTitleContains = selector["titleContains"] as? String
        let selectorValueContains = selector["valueContains"] as? String
        let byRect = selector["byRect"] as? [String: Int]

        // byRole: 严格匹配
        if let byRole = selectorByRole {
            if role != byRole {
                return false
            }
        }

        // titleContains: 必须包含
        if let titleContains = selectorTitleContains {
            guard let t = title else { return false }
            if !t.contains(titleContains) {
                return false
            }
        }

        // valueContains: 必须包含
        if let valueContains = selectorValueContains {
            guard let v = value as? String else { return false }
            if !v.contains(valueContains) {
                return false
            }
        }

        // T16.0.1 修复: byRect 下无 frame 直接剔除
        if let rect = byRect {
            guard let f = frame else { return false }
            if !isElementInRect(f, rect: rect) {
                return false
            }
        }

        return true
    }

    /// T16.0.2: 计算元素的匹配分数（只对通过硬匹配的元素评分）
    private func scoreElement(
        role: String?,
        title: String?,
        value: Any?,
        frame: [String: Int]?,
        selector: [String: Any]
    ) -> (score: Double, reasons: [String]) {
        var score = 0.0
        var reasons: [String] = []

        let selectorByRole = selector["byRole"] as? String
        let selectorTitleContains = selector["titleContains"] as? String
        let selectorValueContains = selector["valueContains"] as? String

        // Role 完全匹配：高权重（+50）
        if let byRole = selectorByRole, role == byRole {
            score += 50.0
            reasons.append("roleExact")
        }

        // Title 包含匹配：中权重（+30）
        if let titleContains = selectorTitleContains, let t = title {
            if t.contains(titleContains) {
                score += 30.0
                reasons.append("titleContains")
                // Title 完全匹配：额外加分（+10）
                if t == titleContains {
                    score += 10.0
                    reasons.append("titleExact")
                }
            }
        }

        // Value 包含匹配：中权重（+20）
        if let valueContains = selectorValueContains, let v = value as? String {
            if v.contains(valueContains) {
                score += 20.0
                reasons.append("valueContains")
            }
        }

        // 有 frame 的元素优先（+5，便于后续点击操作）
        if frame != nil {
            score += 5.0
            reasons.append("hasFrame")
        }

        return (score, reasons)
    }

    // MARK: - T16.0.3: Near 锚点定位辅助方法

    /// T16.0.3: 计算元素中心点
    private func center(_ frame: [String: Int]) -> (x: Double, y: Double) {
        let x = Double(frame["x"] ?? 0) + Double(frame["width"] ?? 0) / 2.0
        let y = Double(frame["y"] ?? 0) + Double(frame["height"] ?? 0) / 2.0
        return (x, y)
    }

    /// T16.0.3: 计算两个元素之间的欧氏距离
    private func distance(_ frame1: [String: Int], _ frame2: [String: Int]) -> Double {
        let c1 = center(frame1)
        let c2 = center(frame2)
        return sqrt(pow(c2.x - c1.x, 2) + pow(c2.y - c1.y, 2))
    }

    /// T16.0.3: 检查目标元素是否在锚点的指定方向
    private func checkDirection(targetFrame: [String: Int], anchorFrame: [String: Int], direction: NearDirection) -> Bool {
        let targetCenter = center(targetFrame)
        let anchorCenter = center(anchorFrame)

        switch direction {
        case .above:
            return targetCenter.y < anchorCenter.y
        case .below:
            return targetCenter.y > anchorCenter.y
        case .left:
            return targetCenter.x < anchorCenter.x
        case .right:
            return targetCenter.x > anchorCenter.x
        }
    }

    /// T16.0.3: 查找锚点元素（第一阶段）
    private func findAnchor(
        selector: [String: Any],
        rootElement: AXUIElement,
        maxDepth: Int
    ) -> AnchorElement? {
        guard let anchorSelector = selector["near"] as? [String: Any],
              let anchorParams = anchorSelector["anchor"] as? [String: Any] else {
            return nil
        }

        // 构造临时 selector 用于查找锚点
        var tempSelector: [String: Any] = [:]
        if let byRole = anchorParams["byRole"] as? String {
            tempSelector["byRole"] = byRole
        }
        if let titleContains = anchorParams["titleContains"] as? String {
            tempSelector["titleContains"] = titleContains
        }
        if let valueContains = anchorParams["valueContains"] as? String {
            tempSelector["valueContains"] = valueContains
        }

        // 遍历查找锚点
        var anchorElement: AnchorElement? = nil

        func findAnchorTraverse(_ element: AXUIElement, depth: Int) {
            if anchorElement != nil { return }  // 已找到

            // 提取属性
            let role = copyAXValue(element, attribute: kAXRoleAttribute) as? String
            let title = copyAXValue(element, attribute: kAXTitleAttribute) as? String
            let value = copyAXValue(element, attribute: kAXValueAttribute)

            // 提取 frame
            var frame: [String: Int]? = nil
            if let pos = copyAXValue(element, attribute: kAXPositionAttribute) as? [String: Any],
               let sz = copyAXValue(element, attribute: kAXSizeAttribute) as? [String: Any] {
                if let x = pos["x"] as? Int, let y = pos["y"] as? Int,
                   let w = sz["width"] as? Int, let h = sz["height"] as? Int {
                    frame = ["x": x, "y": y, "width": w, "height": h]
                }
            }

            // 检查是否匹配锚点 selector
            if passesHardMatch(role: role, title: title, value: value, frame: frame, selector: tempSelector) {
                // 锚点必须有 frame
                guard let f = frame else { return }

                // 生成 fingerprint
                var fingerprintParts: [String] = []
                if let r = role { fingerprintParts.append(r) }
                if let t = title { fingerprintParts.append(t) }
                fingerprintParts.append("x=\(f["x"] ?? 0),y=\(f["y"] ?? 0),w=\(f["width"] ?? 0),h=\(f["height"] ?? 0)")

                anchorElement = AnchorElement(
                    element: element,
                    frame: f,
                    fingerprint: fingerprintParts.joined(separator: "|")
                )
                return
            }

            // 递归子元素
            if depth < maxDepth {
                if let children = copyAXValue(element, attribute: kAXChildrenAttribute) as? [AXUIElement] {
                    for child in children {
                        findAnchorTraverse(child, depth: depth + 1)
                        if anchorElement != nil { return }
                    }
                }
            }
        }

        findAnchorTraverse(rootElement, depth: 0)
        return anchorElement
    }

    // MARK: - T16.0.4: byPath 路径定位辅助方法

    /// T16.0.4: 路径定位元素信息
    private struct PathElement {
        let element: AXUIElement
        let role: String?
        let title: String?
        let value: Any?
        let frame: [String: Int]?
        let fingerprint: String
    }

    /// T16.0.4: 通过索引路径查找元素（单元素精确入口）
    /// - Parameters:
    ///   - path: 索引路径数组 [0, 1, 2] 表示 root[0] -> child[1] -> child[2]
    ///   - rootElement: 根元素（前台应用或系统级）
    ///   - maxDepth: 最大深度限制
    /// - Returns: PathElement 或 nil（路径未命中）
    private func findElementByPath(
        path: [Int],
        rootElement: AXUIElement,
        maxDepth: Int
    ) -> PathElement? {
        guard !path.isEmpty else { return nil }

        let currentElement = rootElement
        var currentPath: [Int] = []

        // 遍历路径，逐层深入
        func traverse(_ element: AXUIElement, depth: Int) -> PathElement? {
            // 检查是否到达目标路径
            if currentPath.count == path.count {
                // 提取元素属性
                let role = copyAXValue(element, attribute: kAXRoleAttribute) as? String
                let title = copyAXValue(element, attribute: kAXTitleAttribute) as? String
                let value = copyAXValue(element, attribute: kAXValueAttribute)

                // 提取 frame
                var frame: [String: Int]? = nil
                if let pos = copyAXValue(element, attribute: kAXPositionAttribute) as? [String: Any],
                   let sz = copyAXValue(element, attribute: kAXSizeAttribute) as? [String: Any] {
                    if let x = pos["x"] as? Int, let y = pos["y"] as? Int,
                       let w = sz["width"] as? Int, let h = sz["height"] as? Int {
                        frame = ["x": x, "y": y, "width": w, "height": h]
                    }
                }

                // 生成 fingerprint
                var fingerprintParts: [String] = []
                if let r = role { fingerprintParts.append(r) }
                if let t = title { fingerprintParts.append(t) }
                if let f = frame {
                    fingerprintParts.append("x=\(f["x"] ?? 0),y=\(f["y"] ?? 0),w=\(f["width"] ?? 0),h=\(f["height"] ?? 0)")
                }

                return PathElement(
                    element: element,
                    role: role,
                    title: title,
                    value: value,
                    frame: frame,
                    fingerprint: fingerprintParts.joined(separator: "|")
                )
            }

            // 深度限制
            guard depth < maxDepth else { return nil }

            // 获取子元素
            guard let children = copyAXValue(element, attribute: kAXChildrenAttribute) as? [AXUIElement] else {
                return nil
            }

            // 获取当前路径索引
            let nextIndex = path[currentPath.count]
            guard nextIndex >= 0, nextIndex < children.count else {
                return nil  // 路径越界（负索引或超出范围）
            }

            currentPath.append(nextIndex)
            let result = traverse(children[nextIndex], depth: depth + 1)
            currentPath.removeLast()

            return result
        }

        return traverse(currentElement, depth: 0)
    }

    /// T16.0.4: 验证路径元素是否符合其他 selector 条件（AND 语义）
    /// - Parameters:
    ///   - pathElement: 通过路径找到的元素
    ///   - selector: 完整 selector（包含 byRole/titleContains/valueContains/byRect）
    /// - Returns: true 表示验证通过
    private func verifyPathElement(
        pathElement: PathElement,
        selector: [String: Any]
    ) -> Bool {
        // 验证 role 匹配（若指定）
        if let selectorByRole = selector["byRole"] as? String {
            guard pathElement.role == selectorByRole else {
                return false  // role 不匹配
            }
        }

        // 验证 titleContains（若指定）
        if let titleContains = selector["titleContains"] as? String {
            guard let t = pathElement.title, t.contains(titleContains) else {
                return false  // title 不匹配
            }
        }

        // 验证 valueContains（若指定）
        if let valueContains = selector["valueContains"] as? String {
            guard let v = pathElement.value as? String, v.contains(valueContains) else {
                return false  // value 不匹配
            }
        }

        // 验证 byRect（若指定）
        if let rect = selector["byRect"] as? [String: Int] {
            guard let f = pathElement.frame else {
                return false  // byRect 需要 frame
            }
            if !isElementInRect(f, rect: rect) {
                return false  // 不在 rect 内
            }
        }

        // 验证指纹合理性（至少有 role 或 frame）
        if pathElement.role == nil && pathElement.frame == nil {
            return false  // 指纹不合理
        }

        // 验证位置合理性（frame 不全为零）
        if let f = pathElement.frame {
            if f["x"] == 0 && f["y"] == 0 && f["width"] == 0 && f["height"] == 0 {
                return false  // 位置不合理（可能是隐藏元素）
            }
        }

        return true
    }

    // MARK: - T16.0.3: desktop.find 实现（三阶段：anchor -> near + 硬匹配过滤 → 评分排序）

    private func handleFind(id: String, params: [String: Any]) -> String {
        guard let meta = params["meta"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing meta")
        }

        guard let workspacePath = meta["workspacePath"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing workspacePath")
        }

        guard let selector = params["selector"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing selector")
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

        // T10: 创建事件写入器
        guard let eventWriter = EventWriter(evidenceDir: evidenceDir) else {
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to create event writer")
        }

        // T10: 写入 start 事件
        eventWriter.write(Event.start(executionId: executionId, method: "desktop.find", params: params))

        // T16.0: 解析 selector 参数
        let selectorByRole = selector["byRole"] as? String
        let selectorTitleContains = selector["titleContains"] as? String
        let selectorValueContains = selector["valueContains"] as? String
        let limit = (selector["limit"] as? Int) ?? 50
        let byRect = selector["byRect"] as? [String: Int]

        // T16.0.3: 解析 near 参数
        let near = selector["near"] as? [String: Any]
        let maxDistance = (near?["maxDistance"] as? Int) ?? 300  // D1: 默认 300
        let directionStr = near?["direction"] as? String
        let nearDirection = directionStr.flatMap { NearDirection(rawValue: $0) }

        // T16.0.4: 解析 byPath 参数（数组形式）
        let byPath = selector["byPath"] as? [Int]

        // 检查 Accessibility 权限
        guard AXIsProcessTrusted() else {
            return JSONRPC.error(id: id, code: BridgeError.permissionMissing.code, message: "Accessibility permission required")
        }

        // 获取系统级 AX 元素
        let systemWideElement = AXUIElementCreateSystemWide()

        // 获取根元素（前台应用或系统级）
        var unwrappedRootElement = systemWideElement
        if let frontmost = NSWorkspace.shared.frontmostApplication {
            let frontmostElement = AXUIElementCreateApplication(frontmost.processIdentifier)
            if copyAXValue(frontmostElement, attribute: kAXRoleAttribute) != nil {
                unwrappedRootElement = frontmostElement
            }
        }

        // T16.0.3: 第 0 阶段 - 查找锚点
        var anchor: AnchorElement? = nil
        if near != nil {
            anchor = findAnchor(selector: selector, rootElement: unwrappedRootElement, maxDepth: 20)

            guard anchor != nil else {
                return JSONRPC.error(
                    id: id,
                    code: BridgeError.anchorNotFound.code,
                    message: "Anchor element not found for near selector"
                )
            }
        }

        // T16.0.3 + T16.0.4: 多阶段流程变量声明
        var passedNearAndHardMatch: [(AXUIElement, String?, String?, Any?, [String: Int]?)] = []
        var nodesVisited = 0
        var nearFilteredCount = 0          // 通过 near 距离过滤的元素数
        var nearRejectedByDirection = 0     // 被 near 方向拒绝的元素数
        var nearRejectedByDistance = 0      // 被 near 距离拒绝的元素数

        // T16.0.4: byPath 单元素精确入口（优先级最高）
        var pathMatched = false
        var pathVerified = false
        var pathFingerprint = ""
        var pathElement: PathElement? = nil

        if let path = byPath {
            // 按路径查找元素
            pathElement = findElementByPath(path: path, rootElement: unwrappedRootElement, maxDepth: 20)

            guard let found = pathElement else {
                return JSONRPC.error(
                    id: id,
                    code: BridgeError.pathNotFound.code,
                    message: "Path not found: \(path)"
                )
            }

            pathMatched = true
            pathFingerprint = found.fingerprint

            // 验证元素是否符合其他 selector 条件（AND 语义）
            pathVerified = verifyPathElement(pathElement: found, selector: selector)

            guard pathVerified else {
                return JSONRPC.error(
                    id: id,
                    code: BridgeError.pathVerificationFailed.code,
                    message: "Path element verification failed for fingerprint: \(found.fingerprint)",
                    details: [
                        "path": path,
                        "pathFingerprint": found.fingerprint,
                        "role": found.role ?? "",
                        "title": found.title ?? ""
                    ]
                )
            }

            // 验证通过，显式执行 near 过滤（若指定）
            // T16.0.4 修复：byPath 命中后仍需通过 near 过滤（距离+方向）
            if near != nil {
                // near 模式下必须有 frame
                guard let f = found.frame else {
                    // near 模式下无 frame，跳过该元素（不报错，因为其他元素可能通过）
                    return JSONRPC.error(
                        id: id,
                        code: BridgeError.pathVerificationFailed.code,
                        message: "Path element found but near filter failed: element has no frame (required for near)",
                        details: [
                            "path": path,
                            "pathFingerprint": found.fingerprint
                        ]
                    )
                }

                // 检查距离
                let dist = distance(f, anchor!.frame)
                if dist > Double(maxDistance) {
                    return JSONRPC.error(
                        id: id,
                        code: BridgeError.pathVerificationFailed.code,
                        message: "Path element found but near filter failed: distance \(dist) exceeds maxDistance \(maxDistance)",
                        details: [
                            "path": path,
                            "pathFingerprint": found.fingerprint,
                            "distance": dist,
                            "maxDistance": maxDistance
                        ]
                    )
                }

                // 检查方向（若指定）
                if let dir = nearDirection {
                    if !checkDirection(targetFrame: f, anchorFrame: anchor!.frame, direction: dir) {
                        return JSONRPC.error(
                            id: id,
                            code: BridgeError.pathVerificationFailed.code,
                            message: "Path element found but near filter failed: direction mismatch",
                            details: [
                                "path": path,
                                "pathFingerprint": found.fingerprint,
                                "expectedDirection": dir.rawValue
                            ]
                        )
                    }
                }

                // near 过滤通过，加入候选
                passedNearAndHardMatch.append((
                    found.element,
                    found.role,
                    found.title,
                    found.value,
                    found.frame
                ))
            } else {
                // 无 near 过滤，直接加入候选
                passedNearAndHardMatch.append((
                    found.element,
                    found.role,
                    found.title,
                    found.value,
                    found.frame
                ))
            }
        }

        // T16.0.3 + T16.0.4: 多阶段流程
        // - 若 byPath 存在：跳过全树遍历，只对 byPath 找到的元素执行 near/hardMatch/scoring
        // - 若 byPath 不存在：执行原有三阶段流程（near + 硬匹配过滤 → 评分排序）
        // 第 1 阶段：near 过滤（距离 + 方向，必须有 frame）
        // 第 2 阶段：硬匹配过滤（byRole/title/value/byRect）
        // 第 3 阶段：评分排序

        func traverse(_ element: AXUIElement, depth: Int) {
            nodesVisited += 1

            // 提取元素属性
            let role = copyAXValue(element, attribute: kAXRoleAttribute) as? String
            let title = copyAXValue(element, attribute: kAXTitleAttribute) as? String
            let value = copyAXValue(element, attribute: kAXValueAttribute)

            // 提取 frame
            var position: [String: Any]? = nil
            var size: [String: Any]? = nil
            if let pos = copyAXValue(element, attribute: kAXPositionAttribute) as? [String: Any] {
                position = pos
            }
            if let sz = copyAXValue(element, attribute: kAXSizeAttribute) as? [String: Any] {
                size = sz
            }

            var frame: [String: Int]? = nil
            if let pos = position, let sz = size {
                if let x = pos["x"] as? Int, let y = pos["y"] as? Int,
                   let w = sz["width"] as? Int, let h = sz["height"] as? Int {
                    frame = ["x": x, "y": y, "width": w, "height": h]
                }
            }

            // T16.0.3: 第 1 阶段 - near 过滤（必须有 frame）
            if near != nil {
                guard let f = frame else { return }  // near 模式下无 frame 直接跳过

                // 检查距离
                let dist = distance(f, anchor!.frame)
                if dist > Double(maxDistance) {
                    nearRejectedByDistance += 1
                    return
                }

                // 检查方向
                if let dir = nearDirection {
                    if !checkDirection(targetFrame: f, anchorFrame: anchor!.frame, direction: dir) {
                        nearRejectedByDirection += 1
                        return
                    }
                }

                nearFilteredCount += 1
            }

            // 第 2 阶段 - 硬匹配过滤
            if passesHardMatch(role: role, title: title, value: value, frame: frame, selector: selector) {
                passedNearAndHardMatch.append((element, role, title, value, frame))
            }

            // 递归遍历子元素（深度限制 20）
            if depth < 20 {
                if let children = copyAXValue(element, attribute: kAXChildrenAttribute) as? [AXUIElement] {
                    for child in children {
                        traverse(child, depth: depth + 1)
                    }
                }
            }
        }

        // T16.0.4: 只在 byPath 不存在时执行全树遍历
        if byPath == nil {
            traverse(unwrappedRootElement, depth: 0)
        }

        // 第 3 阶段 - 评分排序（只对通过的元素评分）
        var scoredElements: [ScoredElement] = []

        for (element, role, title, value, frame) in passedNearAndHardMatch {
            let (score, reasons) = scoreElement(
                role: role,
                title: title,
                value: value,
                frame: frame,
                selector: selector
            )

            // T16.0.3: near 模式下，距离越近分数越高
            if near != nil, let f = frame, let anchorFrame = anchor?.frame {
                let dist = distance(f, anchorFrame)
                if dist < Double(maxDistance) {
                    let proximityScore = max(0, 30.0 - dist / 10.0)  // 0-30 分
                    scoredElements.append(ScoredElement(
                        element: element,
                        role: role,
                        title: title,
                        value: value,
                        frame: f,
                        score: score + proximityScore,
                        reasons: reasons + ["nearAnchor"]
                    ))
                    continue
                }
            }

            let scored = ScoredElement(
                element: element,
                role: role,
                title: title,
                value: value,
                frame: frame,
                score: score,
                reasons: reasons
            )
            scoredElements.append(scored)
        }

        // 按评分降序排序
        scoredElements.sort { $0.score > $1.score }

        // 取前 limit 个
        let topCandidates = Array(scoredElements.prefix(limit))

        // 构建返回结果
        var elementRefs: [[String: Any]] = []
        for (index, scored) in topCandidates.enumerated() {
            var fingerprintParts: [String] = []
            if let r = scored.role { fingerprintParts.append(r) }
            if let t = scored.title { fingerprintParts.append(t) }
            if let f = scored.frame {
                fingerprintParts.append("x=\(f["x"] ?? 0),y=\(f["y"] ?? 0),w=\(f["width"] ?? 0),h=\(f["height"] ?? 0)")
            }
            let fingerprint = fingerprintParts.joined(separator: "|")

            var elementRef: [String: Any] = [
                "elementId": "e:\(index + 1)",
                "fingerprint": fingerprint,
                "score": scored.score,
                "reasons": scored.reasons
            ]

            if let r = scored.role { elementRef["role"] = r }
            if let t = scored.title { elementRef["title"] = t }
            if let v = scored.value { elementRef["value"] = v }
            if let f = scored.frame { elementRef["frame"] = f }

            elementRefs.append(elementRef)
        }

        // 写入 ax.json（T16.0.3: near 统计 + T16.0.4: byPath 统计）
        let axPath = "\(evidenceDir)/ax.json"
        do {
            var selectorData: [String: Any] = [:]
            if let byRole = selectorByRole { selectorData["byRole"] = byRole }
            if let titleContains = selectorTitleContains { selectorData["titleContains"] = titleContains }
            if let valueContains = selectorValueContains { selectorData["valueContains"] = valueContains }
            if let rect = byRect { selectorData["byRect"] = rect }
            // T16.0.3: near 模式存在时，写入 near 配置
            if near != nil {
                var nearData: [String: Any] = ["maxDistance": maxDistance]
                if let dir = nearDirection { nearData["direction"] = dir.rawValue }
                selectorData["near"] = nearData
            }
            // T16.0.4: byPath 存在时，写入路径配置
            if let path = byPath {
                selectorData["byPath"] = path
            }
            selectorData["limit"] = limit

            var axData: [String: Any] = [
                "executionId": executionId,
                "elementRefs": elementRefs,
                "matched": elementRefs.count,
                "nodesVisited": nodesVisited,
                "selector": selectorData,
                "afterScoreCount": scoredElements.count
            ]

            // T16.0.3: 添加 near 统计
            if near != nil {
                axData["anchorMatched"] = true
                axData["anchorFingerprint"] = anchor?.fingerprint ?? ""
                axData["nearFilteredCount"] = nearFilteredCount
                axData["nearRejectedByDirection"] = nearRejectedByDirection
                axData["nearRejectedByDistance"] = nearRejectedByDistance
            }

            // T16.0.4: 添加 byPath 统计
            if byPath != nil {
                axData["pathMatched"] = pathMatched
                axData["pathVerified"] = pathVerified
                axData["pathFingerprint"] = pathFingerprint
            }

            // T16.0.2: 添加 scoring 信息
            axData["scoring"] = [
                "enabled": true,
                "strategy": "pathOrAnchorThenNearThenHardMatchThenScore",
                "rules": "roleExact,titleContains,titleExact,valueContains,hasFrame,nearAnchor,pathVerification"
            ]

            let jsonData = try JSONSerialization.data(withJSONObject: axData, options: .prettyPrinted)
            try jsonData.write(to: URL(fileURLWithPath: axPath))
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

        eventWriter.write(Event.stop(executionId: executionId, method: "desktop.find"))

        return JSONRPC.success(id: id, result: result)
    }

    // MARK: - T14.3A: UI 操作方法实现

    /// desktop.click: 点击 UI 元素（支持 confirm token）
    private func handleClick(id: String, params: [String: Any], peer: PeerIdentity) -> String {
        // 解析参数
        guard let meta = params["meta"] as? [String: Any],
              let workspacePath = meta["workspacePath"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing meta/workspacePath")
        }

        let requestId = meta["requestId"] as? String ?? UUID().uuidString

        // 解析 confirm
        guard let confirm = params["confirm"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing confirm object")
        }

        // 验证 token
        let token: String
        if let t = confirm["token"] as? String {
            token = t
        } else if let phrase = confirm["phrase"] as? String {
            // 短语确认（用于非 token 场景）
            guard phrase == "CONFIRM" || phrase.hasPrefix("CONFIRM:") else {
                return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Invalid confirm phrase")
            }
            token = ""  // 短语确认不需要 token
        } else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing confirm.token or confirm.phrase")
        }

        // 如果有 token，验证它
        if !token.isEmpty {
            let validation = validateToken(token: token, method: "desktop.click", params: params, peer: peer)
            switch validation {
            case .success:
                break  // 继续
            case .invalid:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Invalid token, re-issue required", details: ["reason": "invalid"])
            case .used:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token already consumed, re-issue required", details: ["reason": "used"])
            case .expired:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token expired, re-issue required", details: ["reason": "expired"])
            case .mismatch(let details):
                var mismatchDetails = details
                mismatchDetails["reason"] = "mismatch"
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token scope mismatch, re-issue required", details: mismatchDetails)
            }
        }

        // 解析 target
        guard let target = params["target"] as? [String: Any],
              let selector = target["selector"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing target/selector")
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

        // 创建事件写入器
        guard let eventWriter = EventWriter(evidenceDir: evidenceDir) else {
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to create event writer")
        }

        // 写入 start 事件
        eventWriter.write(Event.start(executionId: executionId, method: "desktop.click", params: params))

        // 检查 Accessibility 权限
        guard AXIsProcessTrusted() else {
            eventWriter.write(Event.error(executionId: executionId, method: "desktop.click", errorCode: "PERMISSION_MISSING", errorMessage: "Accessibility permission required"))
            eventWriter.write(Event.stop(executionId: executionId, method: "desktop.click"))
            return JSONRPC.error(id: id, code: BridgeError.permissionMissing.code, message: "Accessibility permission required")
        }

        // 注册请求（用于 abort）
        registerRequest(requestId)

        // 查找元素
        guard let element = findElement(selector: selector) else {
            eventWriter.write(Event.error(executionId: executionId, method: "desktop.click", errorCode: "ELEMENT_NOT_FOUND", errorMessage: "No matching element found"))
            eventWriter.write(Event.stop(executionId: executionId, method: "desktop.click"))
            unregisterRequest(id)
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Element not found")
        }

        // 检查是否被中止
        if isRequestAborted(requestId) {
            eventWriter.write(Event.error(executionId: executionId, method: "desktop.click", errorCode: "DESKTOP_ABORTED", errorMessage: "Request aborted"))
            eventWriter.write(Event.stop(executionId: executionId, method: "desktop.click"))
            unregisterRequest(id)
            return JSONRPC.error(id: id, code: "DESKTOP_ABORTED", message: "Request aborted")
        }

        // 消费 token
        if !token.isEmpty {
            if !consumeToken(token: token) {
                eventWriter.write(Event.error(executionId: executionId, method: "desktop.click", errorCode: "TOKEN_CONSUME_FAILED", errorMessage: "Failed to consume token"))
                eventWriter.write(Event.stop(executionId: executionId, method: "desktop.click"))
                unregisterRequest(id)
                return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to consume token")
            }
        }

        // 执行点击（使用 AXPress）
        let pressError = AXUIElementPerformAction(element, kAXPressAction as CFString)
        if pressError != .success {
            eventWriter.write(Event.error(executionId: executionId, method: "desktop.click", errorCode: "CLICK_FAILED", errorMessage: "AXUIElementPerformAction failed: \(pressError.rawValue)"))
            eventWriter.write(Event.stop(executionId: executionId, method: "desktop.click"))
            unregisterRequest(id)
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Click action failed: \(pressError.rawValue)")
        }

        // 写入 stop 事件
        eventWriter.write(Event.stop(executionId: executionId, method: "desktop.click", result: ["clicked": true]))

        // T12: 写入 RunTree 索引
        if let runTreeIndex = RunTreeIndex(workspacePath: workspacePath) {
            runTreeIndex.append(executionId: executionId, requestId: id, method: "desktop.click", ok: true, evidenceDir: evidenceDir)
        }

        unregisterRequest(id)

        return JSONRPC.success(id: id, result: [
            "executionId": executionId,
            "clicked": true,
            "evidence": ["dir": evidenceDir, "eventsPath": "events.ndjson"]
        ])
    }

    /// desktop.typeText: 输入文本（剪贴板 + ⌘V，支持 confirm token）
    private func handleTypeText(id: String, params: [String: Any], peer: PeerIdentity) -> String {
        NSLog("=== handleTypeText called ===")
        NSLog("id: \(id), peer: \(peer.auditTokenDigest)")

        // 解析参数
        guard let meta = params["meta"] as? [String: Any],
              let workspacePath = meta["workspacePath"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing meta/workspacePath")
        }

        let requestId = meta["requestId"] as? String ?? UUID().uuidString

        // 解析 confirm
        guard let confirm = params["confirm"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing confirm object")
        }

        // 验证 token
        let token: String
        if let t = confirm["token"] as? String {
            token = t
        } else if let phrase = confirm["phrase"] as? String {
            guard phrase == "CONFIRM" || phrase.hasPrefix("CONFIRM:") else {
                return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Invalid confirm phrase")
            }
            token = ""
        } else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing confirm.token or confirm.phrase")
        }

        // 如果有 token，验证它
        if !token.isEmpty {
            let validation = validateToken(token: token, method: "desktop.typeText", params: params, peer: peer)
            switch validation {
            case .success:
                break
            case .invalid:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Invalid token, re-issue required", details: ["reason": "invalid"])
            case .used:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token already consumed, re-issue required", details: ["reason": "used"])
            case .expired:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token expired, re-issue required", details: ["reason": "expired"])
            case .mismatch(let details):
                var mismatchDetails = details
                mismatchDetails["reason"] = "mismatch"
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token scope mismatch, re-issue required", details: mismatchDetails)
            }
        }

        // 解析 text
        guard let text = params["text"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing text parameter")
        }

        // 解析 target（可选）
        let target = params["target"] as? [String: Any]
        let selector = target?["selector"] as? [String: Any]

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

        // 创建事件写入器
        guard let eventWriter = EventWriter(evidenceDir: evidenceDir) else {
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to create event writer")
        }

        // 写入 start 事件
        eventWriter.write(Event.start(executionId: executionId, method: "desktop.typeText", params: params))

        // 检查 Accessibility 权限
        guard AXIsProcessTrusted() else {
            eventWriter.write(Event.error(executionId: executionId, method: "desktop.typeText", errorCode: "PERMISSION_MISSING", errorMessage: "Accessibility permission required"))
            eventWriter.write(Event.stop(executionId: executionId, method: "desktop.typeText"))
            return JSONRPC.error(id: id, code: BridgeError.permissionMissing.code, message: "Accessibility permission required")
        }

        // 注册请求（用于 abort）
        registerRequest(requestId)

        // 如果有 selector，先点击目标元素
        if let selector = selector {
            guard let element = findElement(selector: selector) else {
                eventWriter.write(Event.error(executionId: executionId, method: "desktop.typeText", errorCode: "ELEMENT_NOT_FOUND", errorMessage: "No matching element found"))
                eventWriter.write(Event.stop(executionId: executionId, method: "desktop.typeText"))
                unregisterRequest(id)
                return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Element not found")
            }

            // 点击元素
            let pressError = AXUIElementPerformAction(element, kAXPressAction as CFString)
            if pressError != .success {
                eventWriter.write(Event.error(executionId: executionId, method: "desktop.typeText", errorCode: "CLICK_FAILED", errorMessage: "AXUIElementPerformAction failed: \(pressError.rawValue)"))
                eventWriter.write(Event.stop(executionId: executionId, method: "desktop.typeText"))
                unregisterRequest(id)
                return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Click action failed: \(pressError.rawValue)")
            }

            // 等待一小段时间让焦点稳定
            Thread.sleep(forTimeInterval: 0.05)
        }

        // 检查是否被中止
        if isRequestAborted(requestId) {
            eventWriter.write(Event.error(executionId: executionId, method: "desktop.typeText", errorCode: "DESKTOP_ABORTED", errorMessage: "Request aborted"))
            eventWriter.write(Event.stop(executionId: executionId, method: "desktop.typeText"))
            unregisterRequest(id)
            return JSONRPC.error(id: id, code: "DESKTOP_ABORTED", message: "Request aborted")
        }

        // 消费 token
        if !token.isEmpty {
            if !consumeToken(token: token) {
                eventWriter.write(Event.error(executionId: executionId, method: "desktop.typeText", errorCode: "TOKEN_CONSUME_FAILED", errorMessage: "Failed to consume token"))
                eventWriter.write(Event.stop(executionId: executionId, method: "desktop.typeText"))
                unregisterRequest(id)
                return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to consume token")
            }
        }

        // 复制文本到剪贴板
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)

        // 发送 ⌘V 快捷键
        sendHotkey(modifiers: .maskCommand, keyCode: UInt32(kVK_ANSI_V))

        // 写入 stop 事件
        eventWriter.write(Event.stop(executionId: executionId, method: "desktop.typeText", result: ["text": text, "method": "clipboard+cmd+v"]))

        // T12: 写入 RunTree 索引
        if let runTreeIndex = RunTreeIndex(workspacePath: workspacePath) {
            runTreeIndex.append(executionId: executionId, requestId: id, method: "desktop.typeText", ok: true, evidenceDir: evidenceDir)
        }

        unregisterRequest(id)

        return JSONRPC.success(id: id, result: [
            "executionId": executionId,
            "text": text,
            "method": "clipboard+cmd+v",
            "evidence": ["dir": evidenceDir, "eventsPath": "events.ndjson"]
        ])
    }

    /// desktop.hotkey: 发送快捷键（支持 confirm token）
    private func handleHotkey(id: String, params: [String: Any], peer: PeerIdentity) -> String {
        // 解析参数
        guard let meta = params["meta"] as? [String: Any],
              let workspacePath = meta["workspacePath"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing meta/workspacePath")
        }

        let requestId = meta["requestId"] as? String ?? UUID().uuidString

        // 解析 confirm
        guard let confirm = params["confirm"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing confirm object")
        }

        // 验证 token
        let token: String
        if let t = confirm["token"] as? String {
            token = t
        } else if let phrase = confirm["phrase"] as? String {
            guard phrase == "CONFIRM" || phrase.hasPrefix("CONFIRM:") else {
                return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Invalid confirm phrase")
            }
            token = ""
        } else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing confirm.token or confirm.phrase")
        }

        // 如果有 token，验证它
        if !token.isEmpty {
            let validation = validateToken(token: token, method: "desktop.hotkey", params: params, peer: peer)
            switch validation {
            case .success:
                break
            case .invalid:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Invalid token, re-issue required", details: ["reason": "invalid"])
            case .used:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token already consumed, re-issue required", details: ["reason": "used"])
            case .expired:
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token expired, re-issue required", details: ["reason": "expired"])
            case .mismatch(let details):
                var mismatchDetails = details
                mismatchDetails["reason"] = "mismatch"
                return JSONRPC.error(id: id, code: BridgeError.confirmRequired.code, message: "Token scope mismatch, re-issue required", details: mismatchDetails)
            }
        }

        // 解析 keys
        guard let keys = params["keys"] as? [String] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing keys parameter")
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

        // 创建事件写入器
        guard let eventWriter = EventWriter(evidenceDir: evidenceDir) else {
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to create event writer")
        }

        // 写入 start 事件
        eventWriter.write(Event.start(executionId: executionId, method: "desktop.hotkey", params: params))

        // 注册请求（用于 abort）
        registerRequest(requestId)

        // 检查是否被中止
        if isRequestAborted(requestId) {
            eventWriter.write(Event.error(executionId: executionId, method: "desktop.hotkey", errorCode: "DESKTOP_ABORTED", errorMessage: "Request aborted"))
            eventWriter.write(Event.stop(executionId: executionId, method: "desktop.hotkey"))
            unregisterRequest(id)
            return JSONRPC.error(id: id, code: "DESKTOP_ABORTED", message: "Request aborted")
        }

        // 消费 token
        if !token.isEmpty {
            if !consumeToken(token: token) {
                eventWriter.write(Event.error(executionId: executionId, method: "desktop.hotkey", errorCode: "TOKEN_CONSUME_FAILED", errorMessage: "Failed to consume token"))
                eventWriter.write(Event.stop(executionId: executionId, method: "desktop.hotkey"))
                unregisterRequest(id)
                return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to consume token")
            }
        }

        // 解析并执行快捷键
        for key in keys {
            // 支持 enter 和 cmd+v
            if key == "enter" {
                sendHotkey(modifiers: [], keyCode: UInt32(kVK_Return))
            } else if key == "cmd+v" || key == "command+v" {
                sendHotkey(modifiers: .maskCommand, keyCode: UInt32(kVK_ANSI_V))
            } else if key == "tab" {
                sendHotkey(modifiers: [], keyCode: UInt32(kVK_Tab))
            } else if key == "space" {
                sendHotkey(modifiers: [], keyCode: UInt32(kVK_Space))
            } else if key == "escape" || key == "esc" {
                sendHotkey(modifiers: [], keyCode: UInt32(kVK_Escape))
            } else if key.hasPrefix("cmd+") || key.hasPrefix("command+") {
                // 解析 cmd+x 格式
                let keyChar = key.dropFirst(4)
                if let keyCode = keyCodeForChar(keyChar.first ?? Character("")) {
                    sendHotkey(modifiers: .maskCommand, keyCode: keyCode)
                }
            } else if key.count == 1 {
                // 单字符按键
                if let keyCode = keyCodeForChar(key.first ?? Character("")) {
                    sendHotkey(modifiers: [], keyCode: keyCode)
                }
            } else {
                eventWriter.write(Event.error(executionId: executionId, method: "desktop.hotkey", errorCode: "UNSUPPORTED_KEY", errorMessage: "Unsupported key: \(key)"))
            }
        }

        // 写入 stop 事件
        eventWriter.write(Event.stop(executionId: executionId, method: "desktop.hotkey", result: ["keys": keys]))

        // T12: 写入 RunTree 索引
        if let runTreeIndex = RunTreeIndex(workspacePath: workspacePath) {
            runTreeIndex.append(executionId: executionId, requestId: id, method: "desktop.hotkey", ok: true, evidenceDir: evidenceDir)
        }

        unregisterRequest(id)

        return JSONRPC.success(id: id, result: [
            "executionId": executionId,
            "keys": keys,
            "evidence": ["dir": evidenceDir, "eventsPath": "events.ndjson"]
        ])
    }

    // MARK: - T16.0.5: Modal 检测与处理

    /// T16.0.5: Modal 检测器类型（支持注入测试用 mock）
    private typealias ModalDetector = (String?, Int, Int) -> [ModalInfo]

    /// T16.0.5: 当前 modal 检测器（可被测试注入，nil 时使用默认实现）
    private var currentModalDetector: ModalDetector?

    // MARK: - T16.0.6: TestHooksPolicy 统一测试钩子策略

    /// T16.0.6: 测试钩子策略（收敛版：环境变量 + 参数双检查）
    private struct TestHooksPolicy {
        /// 检查测试钩子是否启用
        /// - Parameters:
        ///   - params: RPC 请求参数
        ///   - env: 环境变量字典（默认为 ProcessInfo.processInfo.environment）
        /// - Returns: true 表示测试钩子可用，false 表示禁用
        static func isEnabled(params: [String: Any], env: [String: String] = ProcessInfo.processInfo.environment) -> Bool {
            // 检查 1: 环境变量必须为 "1"
            guard env["OPENCLAW_DESKTOP_TEST_HOOKS"] == "1" else {
                return false
            }

            // 检查 2: 请求参数里必须有 _testMode === true
            if let meta = params["meta"] as? [String: Any],
               let testMode = meta["_testMode"] as? Bool,
               testMode {
                return true
            }

            return false
        }
    }

    /// T16.0.5: Modal 信息结构
    private struct ModalInfo {
        let element: AXUIElement
        let role: String
        let title: String?
        let frame: [String: Int]?
        let buttons: [[String: Any]]  // 可用的按钮列表
    }

    /// T16.0.5: DismissModal 策略类型
    private enum DismissStrategy: String {
        case defaultButton = "defaultButton"
        case byTitle = "byTitle"
        case esc = "esc"
    }

    /// T16.0.5: 检测前台应用的 Modal 窗口
    /// - Parameters:
    ///   - bundleId: 目标应用的 bundleId（若指定，验证前台应用）
    /// - maxDepth: 最大遍历深度
    /// - maxModals: 最多返回的 modal 数量
    /// - Returns: Modal 信息数组
    private func detectModalsImpl(bundleId: String? = nil, maxDepth: Int = 5, maxModals: Int = 10) -> [ModalInfo] {
        var modals: [ModalInfo] = []

        // 获取前台应用
        guard let frontmost = NSWorkspace.shared.frontmostApplication else {
            return modals
        }

        // 验证 bundleId（若指定）
        if let bundleId = bundleId {
            guard frontmost.bundleIdentifier == bundleId else {
                return modals
            }
        }

        let appElement = AXUIElementCreateApplication(frontmost.processIdentifier)

        // 获取所有窗口
        guard let windows = copyAXValue(appElement, attribute: kAXWindowsAttribute) as? [AXUIElement] else {
            return modals
        }

        // T16.0.5 P0 debug: 记录检测到的窗口信息
        logger.debug("detectModals: found \(windows.count) windows for bundleId=\(bundleId ?? "nil")")

        // Modal 相关的 AXRole（扩展检测范围）
        let modalRoles = ["AXSheet", "AXDialog", "AXAlert", "AXSystemDialog"]
        // Modal 相关的 AXSubrole
        let modalSubroles = ["AXSystemDialog", "AXDialog", "AXFloatingWindow"]

        for window in windows {
            guard modals.count < maxModals else { break }

            guard let role = copyAXValue(window, attribute: kAXRoleAttribute) as? String else {
                continue
            }

            let title = copyAXValue(window, attribute: kAXTitleAttribute) as? String
            let visible = copyAXValue(window, attribute: "AXVisible") as? Bool
            let focused = copyAXValue(window, attribute: "AXFocused") as? Bool
            let subrole = copyAXValue(window, attribute: kAXSubroleAttribute) as? String

            logger.debug("  window: role=\(role), title=\(title ?? "nil"), visible=\(visible ?? false), focused=\(focused ?? false), subrole=\(subrole ?? "nil")")

            // 判断是否为 modal 类型窗口
            let isModalRole = modalRoles.contains(role)
            let isModalSubrole = subrole != nil && modalSubroles.contains(subrole!)

            // 扩展检测：focused 的 AXWindow 也可能是 modal
            let isFocusedWindow = (role == "AXWindow") && (focused == true)

            guard isModalRole || isModalSubrole || isFocusedWindow else {
                continue
            }

            // 检查是否可见（使用字符串 "AXVisible"）
            // visible 已在上面调试代码中提取

            guard let visible = copyAXValue(window, attribute: "AXVisible") as? Bool, visible else {
                continue
            }

            // 提取 frame（title 已在调试代码中提取）
            var frame: [String: Int]? = nil
            if let pos = copyAXValue(window, attribute: kAXPositionAttribute) as? [String: Any],
               let sz = copyAXValue(window, attribute: kAXSizeAttribute) as? [String: Any] {
                if let x = pos["x"] as? Int, let y = pos["y"] as? Int,
                   let w = sz["width"] as? Int, let h = sz["height"] as? Int {
                    frame = ["x": x, "y": y, "width": w, "height": h]
                }
            }

            // 提取按钮（用于 dismissModal）
            var buttons: [[String: Any]] = []
            if let children = copyAXValue(window, attribute: kAXChildrenAttribute) as? [AXUIElement] {
                for child in children {
                    if let childRole = copyAXValue(child, attribute: kAXRoleAttribute) as? String,
                       childRole == "AXButton" {
                        let childTitle = copyAXValue(child, attribute: kAXTitleAttribute) as? String
                        let childSubrole = copyAXValue(child, attribute: kAXSubroleAttribute) as? String
                        var buttonInfo: [String: Any] = ["role": childRole]
                        if let t = childTitle { buttonInfo["title"] = t }
                        if let s = childSubrole { buttonInfo["subrole"] = s }
                        buttons.append(buttonInfo)
                    }
                }
            }

            modals.append(ModalInfo(
                element: window,
                role: role,
                title: title,
                frame: frame,
                buttons: buttons
            ))
            logger.debug("  ✓ matched as modal: role=\(role), title=\(title ?? "nil")")
        }

        logger.debug("detectModals: found \(modals.count) modals")
        return modals

        return modals
    }

    /// T16.0.5: 检查是否有 Modal 阻塞前台应用
    /// - Parameter bundleId: 目标应用的 bundleId（可选）
    /// - Returns: 阻塞的 Modal 信息，若无阻塞则返回 nil
    private func checkModalBlocking(bundleId: String? = nil) -> ModalInfo? {
        let modals = detectModalsImpl(bundleId: bundleId, maxDepth: 2, maxModals: 20)

        // 检查是否有 focused 的 modal
        for modal in modals {
            // 检查 modal 是否为 focused 窗口
            if let focused = copyAXValue(modal.element, attribute: kAXFocusedAttribute) as? Bool, focused {
                return modal  // focused modal 视为阻塞
            }

            // 检查 modal 是否为 main 窗口
            if let main = copyAXValue(modal.element, attribute: kAXMainAttribute) as? Bool, main {
                return modal  // main modal 视为阻塞
            }
        }

        // 如果有 Sheet 类型，通常也是阻塞的
        for modal in modals {
            if modal.role == "AXSheet" {
                return modal
            }
        }

        return nil
    }

    // MARK: - T16.0.5: desktop.highlight 实现

    /// desktop.highlight: 高亮显示目标元素（调试用）
    private func handleHighlight(id: String, params: [String: Any]) -> String {
        guard let meta = params["meta"] as? [String: Any],
              let workspacePath = meta["workspacePath"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing meta/workspacePath")
        }

        let executionId = UUID().uuidString
        let requestId = meta["requestId"] as? String ?? UUID().uuidString
        let durationMs = (params["durationMs"] as? Int) ?? 1200

        // 创建证据目录
        let evidenceDir = createEvidenceDir(workspacePath: workspacePath, executionId: executionId)
        guard let eventWriter = EventWriter(evidenceDir: evidenceDir) else {
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to create event writer")
        }

        eventWriter.write(Event.start(executionId: executionId, method: "desktop.highlight", params: params))

        // 检查 Accessibility 权限
        guard AXIsProcessTrusted() else {
            return JSONRPC.error(id: id, code: BridgeError.permissionMissing.code, message: "Accessibility permission required")
        }

        // 解析 target（支持 elementRef 或 selector）
        guard let target = params["target"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing target")
        }

        // 查找目标元素
        let elements: [[String: Any]]
        if let _ = target["elementRef"] as? [String: Any] {
            // 直接使用 elementRef（暂不支持，需要重新查找）
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "elementRef target not yet supported, use selector")
        } else if let selector = target["selector"] as? [String: Any] {
            // 使用 selector 查找元素
            let findResult = findElements(selector: selector, limit: 1)
            elements = findResult.map { info in
                var elem: [String: Any] = ["elementId": info.elementId]
                if let r = info.role { elem["role"] = r }
                if let t = info.title { elem["title"] = t }
                if let f = info.frame { elem["frame"] = f }
                return elem
            }
        } else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Invalid target: must provide selector or elementRef")
        }

        guard !elements.isEmpty else {
            return JSONRPC.error(id: id, code: BridgeError.elementNotFound.code, message: "No element found matching selector")
        }

        let element = elements[0]
        guard let frame = element["frame"] as? [String: Int] else {
            return JSONRPC.error(id: id, code: BridgeError.elementNotFound.code, message: "Element has no frame for highlighting")
        }

        // 使用 HighlightOverlay 显示高亮
        HighlightOverlay.shared.showHighlight(
            frame: CGRect(
                x: CGFloat(frame["x"] ?? 0),
                y: CGFloat(frame["y"] ?? 0),
                width: CGFloat(frame["width"] ?? 0),
                height: CGFloat(frame["height"] ?? 0)
            ),
            duration: Double(durationMs) / 1000.0
        )

        // T12: 写入 RunTree 索引
        if let runTreeIndex = RunTreeIndex(workspacePath: workspacePath) {
            runTreeIndex.append(executionId: executionId, requestId: requestId, method: "desktop.highlight", ok: true, evidenceDir: evidenceDir)
        }

        eventWriter.write(Event.stop(executionId: executionId, method: "desktop.highlight", result: ["highlighted": true]))

        return JSONRPC.success(id: id, result: [
            "executionId": executionId,
            "highlighted": true,
            "evidence": ["dir": evidenceDir, "eventsPath": "events.ndjson"]
        ])
    }

    // MARK: - T16.0.5: desktop.listModals 实现

    /// desktop.listModals: 列出前台应用的 Modal 窗口
    private func handleListModals(id: String, params: [String: Any]) -> String {
        guard let meta = params["meta"] as? [String: Any],
              let workspacePath = meta["workspacePath"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing meta/workspacePath")
        }

        let executionId = UUID().uuidString
        let requestId = meta["requestId"] as? String ?? UUID().uuidString

        // 解析 route
        var targetBundleId: String? = nil
        if let route = params["route"] as? [String: Any],
           let bundleId = route["appBundleId"] as? String {
            targetBundleId = bundleId
        }

        // 创建证据目录
        let evidenceDir = createEvidenceDir(workspacePath: workspacePath, executionId: executionId)
        guard let eventWriter = EventWriter(evidenceDir: evidenceDir) else {
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to create event writer")
        }

        eventWriter.write(Event.start(executionId: executionId, method: "desktop.listModals", params: params))

        // 检查 Accessibility 权限
        guard AXIsProcessTrusted() else {
            return JSONRPC.error(id: id, code: BridgeError.permissionMissing.code, message: "Accessibility permission required")
        }

        // 检测 modals
        let modals = detectModalsImpl(bundleId: targetBundleId, maxDepth: 2, maxModals: 20)

        // 转换为返回格式
        let modalList = modals.map { modal -> [String: Any] in
            var info: [String: Any] = [
                "role": modal.role,
                "buttons": modal.buttons
            ]
            if let t = modal.title { info["title"] = t }
            if let f = modal.frame { info["frame"] = f }
            return info
        }

        // 写入 modals.json
        let modalsPath = "\(evidenceDir)/modals.json"
        do {
            let modalsData: [String: Any] = [
                "executionId": executionId,
                "modals": modalList,
                "detectedAt": ISO8601DateFormatter().string(from: Date())
            ]
            let jsonData = try JSONSerialization.data(withJSONObject: modalsData, options: .prettyPrinted)
            try jsonData.write(to: URL(fileURLWithPath: modalsPath))
        } catch {
            logger.error("Failed to write modals.json: \(error)")
        }

        // T12: 写入 RunTree 索引
        if let runTreeIndex = RunTreeIndex(workspacePath: workspacePath) {
            runTreeIndex.append(executionId: executionId, requestId: requestId, method: "desktop.listModals", ok: true, evidenceDir: evidenceDir)
        }

        eventWriter.write(Event.stop(executionId: executionId, method: "desktop.listModals", result: ["modals": modalList]))

        return JSONRPC.success(id: id, result: [
            "executionId": executionId,
            "modals": modalList,
            "evidence": ["dir": evidenceDir, "modalsPath": "modals.json"]
        ])
    }

    // MARK: - T16.0.5: desktop.dismissModal 实现

    /// desktop.dismissModal: 关闭 Modal 窗口
    private func handleDismissModal(id: String, params: [String: Any]) -> String {
        guard let meta = params["meta"] as? [String: Any],
              let workspacePath = meta["workspacePath"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing meta/workspacePath")
        }

        let executionId = UUID().uuidString
        let requestId = meta["requestId"] as? String ?? UUID().uuidString

        // 解析 route
        var targetBundleId: String? = nil
        if let route = params["route"] as? [String: Any],
           let bundleId = route["appBundleId"] as? String {
            targetBundleId = bundleId
        }

        // 解析 strategy
        guard let strategy = params["strategy"] as? [String: Any],
              let strategyType = strategy["type"] as? String,
              let dismissStrategy = DismissStrategy(rawValue: strategyType) else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing or invalid strategy.type")
        }

        // 创建证据目录
        let evidenceDir = createEvidenceDir(workspacePath: workspacePath, executionId: executionId)
        guard let eventWriter = EventWriter(evidenceDir: evidenceDir) else {
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to create event writer")
        }

        eventWriter.write(Event.start(executionId: executionId, method: "desktop.dismissModal", params: params))

        // 检查 Accessibility 权限
        guard AXIsProcessTrusted() else {
            return JSONRPC.error(id: id, code: BridgeError.permissionMissing.code, message: "Accessibility permission required")
        }

        // 检测 modals
        let modals = detectModalsImpl(bundleId: targetBundleId, maxDepth: 2, maxModals: 20)

        guard !modals.isEmpty else {
            eventWriter.write(Event.stop(executionId: executionId, method: "desktop.dismissModal", result: ["dismissed": false]))
            return JSONRPC.success(id: id, result: [
                "executionId": executionId,
                "dismissed": false,
                "reason": "No modals found"
            ])
        }

        // 选择第一个 modal 进行关闭
        let modal = modals[0]
        var dismissed = false
        var matchedModal: [String: Any]?

        switch dismissStrategy {
        case .defaultButton:
            // 查找默认按钮（subrole = "AXCancel" 或 "AXDefault" 或 title 包含 "OK"/"Cancel"）
            for button in modal.buttons {
                let subrole = button["subrole"] as? String
                let title = button["title"] as? String

                if subrole == "AXCancelButton" || subrole == "AXDefaultButton" ||
                   title == "OK" || title == "Cancel" {
                    if let element = findButtonInModal(modal: modal, title: title, subrole: subrole) {
                        let pressError = AXUIElementPerformAction(element, kAXPressAction as CFString)
                        if pressError == .success {
                            dismissed = true
                            matchedModal = ["strategy": "defaultButton", "button": button]
                        }
                        break
                    }
                }
            }

        case .byTitle:
            // 按标题查找按钮
            guard let titleContains = strategy["titleContains"] as? String else {
                return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "strategy.byTitle requires titleContains")
            }

            for button in modal.buttons {
                if let title = button["title"] as? String, title.contains(titleContains) {
                    if let element = findButtonInModal(modal: modal, title: title, subrole: nil) {
                        let pressError = AXUIElementPerformAction(element, kAXPressAction as CFString)
                        if pressError == .success {
                            dismissed = true
                            matchedModal = ["strategy": "byTitle", "button": button]
                        }
                        break
                    }
                }
            }

        case .esc:
            // 发送 ESC 键
            sendESCKey()
            dismissed = true
            matchedModal = ["strategy": "esc"]
        }

        // 写入 modals.json
        let modalsPath = "\(evidenceDir)/modals.json"
        do {
            let modalsData: [String: Any] = [
                "executionId": executionId,
                "modals": modals.map { m in
                    var info: [String: Any] = ["role": m.role, "buttons": m.buttons]
                    if let t = m.title { info["title"] = t }
                    return info
                },
                "dismissed": dismissed,
                "matchedModal": matchedModal ?? [:]
            ]
            let jsonData = try JSONSerialization.data(withJSONObject: modalsData, options: .prettyPrinted)
            try jsonData.write(to: URL(fileURLWithPath: modalsPath))
        } catch {
            logger.error("Failed to write modals.json: \(error)")
        }

        // T12: 写入 RunTree 索引
        if let runTreeIndex = RunTreeIndex(workspacePath: workspacePath) {
            runTreeIndex.append(executionId: executionId, requestId: requestId, method: "desktop.dismissModal", ok: true, evidenceDir: evidenceDir)
        }

        eventWriter.write(Event.stop(executionId: executionId, method: "desktop.dismissModal", result: ["dismissed": dismissed]))

        return JSONRPC.success(id: id, result: [
            "executionId": executionId,
            "dismissed": dismissed,
            "strategy": strategyType,
            "matchedModal": matchedModal ?? [:],
            "evidence": ["dir": evidenceDir, "modalsPath": "modals.json"]
        ])
    }

    // MARK: - T16.0.5 辅助方法

    /// 在 Modal 中查找按钮元素
    /// 注意：简化实现，实际需要遍历 modal.element 获取按钮的 AXUIElement
    private func findButtonInModal(modal: ModalInfo, title: String?, subrole: String?) -> AXUIElement? {
        // 遍历 modal 的子元素查找匹配的按钮
        func findButton(_ element: AXUIElement) -> AXUIElement? {
            let role = copyAXValue(element, attribute: kAXRoleAttribute) as? String
            guard role == "AXButton" else { return nil }

            // 检查 title
            if let titleRequirement = title {
                let elemTitle = copyAXValue(element, attribute: kAXTitleAttribute) as? String
                guard let t = elemTitle, t.contains(titleRequirement) else { return nil }
            }

            // 检查 subrole
            if let subroleRequirement = subrole {
                let elemSubrole = copyAXValue(element, attribute: kAXSubroleAttribute) as? String
                guard let s = elemSubrole, s == subroleRequirement else { return nil }
            }

            return element
        }

        // 遍历 modal 的子元素
        if let children = copyAXValue(modal.element, attribute: kAXChildrenAttribute) as? [AXUIElement] {
            for child in children {
                if let button = findButton(child) {
                    return button
                }
            }
        }

        return nil
    }

    /// 发送 ESC 键（简化实现）
    private func sendESCKey() {
        // 使用 keyCode 53 (ESC) 或 kVK_Escape
        let source = CGEventSource(stateID: .hidSystemState)

        // 创建按键按下事件
        if let keyDown = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(53), keyDown: true) {
            keyDown.flags = .maskNonCoalesced
            keyDown.post(tap: .cghidEventTap)
        }

        // 创建按键释放事件
        if let keyUp = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(53), keyDown: false) {
            keyUp.flags = .maskNonCoalesced
            keyUp.post(tap: .cghidEventTap)
        }
    }

    /// 创建证据目录的辅助方法
    private func createEvidenceDir(workspacePath: String, executionId: String) -> String {
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let dateStr = dateFormatter.string(from: Date())

        let evidenceDir = "\(workspacePath)/artifacts/desktop/\(dateStr)/\(executionId)"

        do {
            try FileManager.default.createDirectory(atPath: evidenceDir, withIntermediateDirectories: true)
        } catch {
            logger.error("Failed to create evidence directory: \(error)")
        }

        return evidenceDir
    }

    /// 查找元素（简化实现，复用基本的查找逻辑）
    private func findElements(selector: [String: Any], limit: Int) -> [(elementId: String, role: String?, title: String?, frame: [String: Int]?)] {
        var results: [(elementId: String, role: String?, title: String?, frame: [String: Int]?)] = []

        // 获取系统级 AX 元素
        let systemWideElement = AXUIElementCreateSystemWide()

        // 获取根元素（前台应用）
        var rootElement = systemWideElement
        if let frontmost = NSWorkspace.shared.frontmostApplication {
            let frontmostElement = AXUIElementCreateApplication(frontmost.processIdentifier)
            if copyAXValue(frontmostElement, attribute: kAXRoleAttribute) != nil {
                rootElement = frontmostElement
            }
        }

        let selectorByRole = selector["byRole"] as? String
        let selectorTitleContains = selector["titleContains"] as? String

        // 遍历查找元素
        func traverse(_ element: AXUIElement, depth: Int) {
            guard results.count < limit else { return }
            guard depth < 20 else { return }

            let role = copyAXValue(element, attribute: kAXRoleAttribute) as? String
            let title = copyAXValue(element, attribute: kAXTitleAttribute) as? String

            // 提取 frame
            var frame: [String: Int]? = nil
            if let pos = copyAXValue(element, attribute: kAXPositionAttribute) as? [String: Any],
               let sz = copyAXValue(element, attribute: kAXSizeAttribute) as? [String: Any] {
                if let x = pos["x"] as? Int, let y = pos["y"] as? Int,
                   let w = sz["width"] as? Int, let h = sz["height"] as? Int {
                    frame = ["x": x, "y": y, "width": w, "height": h]
                }
            }

            // 检查匹配条件
            var matches = true
            if let byRole = selectorByRole {
                matches = matches && (role == byRole)
            }
            if let titleContains = selectorTitleContains {
                matches = matches && (title != nil && title!.contains(titleContains))
            }

            if matches {
                results.append((
                    "e:\(results.count + 1)",
                    role,
                    title,
                    frame
                ))
            }

            // 递归子元素
            if let children = copyAXValue(element, attribute: kAXChildrenAttribute) as? [AXUIElement] {
                for child in children {
                    traverse(child, depth: depth + 1)
                }
            }
        }

        traverse(rootElement, depth: 0)
        return results
    }

    /// desktop.waitUntil: 等待 UI 条件成立（轮询 + find，支持 abort/timeout + modal 检测）
    private func handleWaitUntil(id: String, params: [String: Any]) -> String {
        // 解析参数
        guard let meta = params["meta"] as? [String: Any],
              let workspacePath = meta["workspacePath"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing meta/workspacePath")
        }

        let requestId = meta["requestId"] as? String ?? UUID().uuidString
        let timeoutMs = (params["timeoutMs"] as? Int) ?? 10000
        let pollIntervalMs: UInt64 = 200  // 每 200ms 轮询一次
        let startTime = Date()

        // 解析 condition
        guard let condition = params["condition"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing condition")
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

        // 创建事件写入器
        guard let eventWriter = EventWriter(evidenceDir: evidenceDir) else {
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to create event writer")
        }

        // 写入 start 事件
        eventWriter.write(Event.start(executionId: executionId, method: "desktop.waitUntil", params: params))

        // 检查 Accessibility 权限
        guard AXIsProcessTrusted() else {
            eventWriter.write(Event.error(executionId: executionId, method: "desktop.waitUntil", errorCode: "PERMISSION_MISSING", errorMessage: "Accessibility permission required"))
            eventWriter.write(Event.stop(executionId: executionId, method: "desktop.waitUntil"))
            return JSONRPC.error(id: id, code: BridgeError.permissionMissing.code, message: "Accessibility permission required")
        }

        // 注册请求（用于 abort）
        registerRequest(requestId)

        // 轮询检查条件
        var conditionMet = false
        var iterations = 0

        while Date().timeIntervalSince(startTime) < Double(timeoutMs) / 1000.0 {
            iterations += 1

            // 检查是否被中止
            if isRequestAborted(requestId) {
                eventWriter.write(Event.error(executionId: executionId, method: "desktop.waitUntil", errorCode: "DESKTOP_ABORTED", errorMessage: "Request aborted after \(iterations) iterations"))
                eventWriter.write(Event.stop(executionId: executionId, method: "desktop.waitUntil"))
                unregisterRequest(requestId)
                return JSONRPC.error(id: id, code: BridgeError.aborted.code, message: "Request aborted after \(iterations) iterations")
            }

            // T16.0.5: 检查 modal 阻塞（使用可注入的 detector）
            let detector = currentModalDetector ?? { bundleId, maxDepth, maxModals in
                return self.detectModalsImpl(bundleId: bundleId, maxDepth: maxDepth, maxModals: maxModals)
            }
            let modals = detector(nil, 2, 1)
            if !modals.isEmpty {
                let modal = modals[0]
                eventWriter.write(Event.error(executionId: executionId, method: "desktop.waitUntil", errorCode: BridgeError.modalBlocking.code, errorMessage: "Modal blocking: role=\(modal.role), title=\(modal.title ?? "(nil)")"))
                eventWriter.write(Event.stop(executionId: executionId, method: "desktop.waitUntil"))
                unregisterRequest(requestId)
                return JSONRPC.error(id: id, code: BridgeError.modalBlocking.code, message: "Modal blocking: role=\(modal.role), title=\(modal.title ?? "(nil)")")
            }

            // 检查条件：selectorExists
            if let selectorExists = condition["selectorExists"] as? [String: Any] {
                if findElement(selector: selectorExists) != nil {
                    conditionMet = true
                    break
                }
            }

            // 检查条件：valueContains
            if let valueContains = condition["valueContains"] as? [String: Any] {
                if let selector = valueContains["selector"] as? [String: Any],
                   let expectedValue = valueContains["value"] as? String {
                    if let element = findElement(selector: selector),
                       let actualValue = copyAXValue(element, attribute: kAXValueAttribute) as? String {
                        if actualValue.contains(expectedValue) {
                            conditionMet = true
                            break
                        }
                    }
                }
            }

            // 等待下一次轮询
            usleep(useconds_t(pollIntervalMs * 1000))
        }

        // 注销请求
        unregisterRequest(requestId)

        if conditionMet {
            // 写入 stop 事件（成功）
            eventWriter.write(Event.stop(executionId: executionId, method: "desktop.waitUntil", result: ["conditionMet": true, "iterations": iterations]))

            // T12: 写入 RunTree 索引
            if let runTreeIndex = RunTreeIndex(workspacePath: workspacePath) {
                runTreeIndex.append(executionId: executionId, requestId: id, method: "desktop.waitUntil", ok: true, evidenceDir: evidenceDir)
            }

            return JSONRPC.success(id: id, result: [
                "executionId": executionId,
                "conditionMet": true,
                "iterations": iterations,
                "evidence": ["dir": evidenceDir, "eventsPath": "events.ndjson"]
            ])
        } else {
            // 超时
            eventWriter.write(Event.error(executionId: executionId, method: "desktop.waitUntil", errorCode: "TIMEOUT", errorMessage: "Condition not met after \(iterations) iterations"))
            eventWriter.write(Event.stop(executionId: executionId, method: "desktop.waitUntil"))

            return JSONRPC.error(id: id, code: "DESKTOP_TIMEOUT", message: "Condition not met after \(iterations) iterations")
        }
    }

    /// T16.0.5: 注入测试用 modal detector（仅用于测试）
    /// - Parameter detector: 自定义 modal 检测器，返回模拟的 modal 数组
    /// - Note: 测试完成后应调用 clearTestModalDetector() 清理
    private func setTestModalDetector(_ detector: @escaping ModalDetector) {
        currentModalDetector = detector
        logger.debug("Test modal detector injected")
    }

    /// T16.0.5: 清除测试用 modal detector
    private func clearTestModalDetector() {
        currentModalDetector = nil
        logger.debug("Test modal detector cleared")
    }

    /// T16.0.5: 测试用 RPC - 注入 mock modal detector
    private func handleTestInjectModalDetector(id: String, params: [String: Any]) -> String {
        guard let mockModals = params["mockModals"] as? [[String: Any]] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing mockModals array")
        }

        // 将 mock 数据转换为 ModalInfo 数组
        let mockModalInfos: [ModalInfo] = mockModals.compactMap { mock in
            guard let role = mock["role"] as? String,
                  let pid = mock["pid"] as? pid_t else {
                return nil
            }
            let app = AXUIElementCreateApplication(pid)
            return ModalInfo(
                element: app,
                role: role,
                title: mock["title"] as? String,
                frame: mock["frame"] as? [String: Int],
                buttons: mock["buttons"] as? [[String: Any]] ?? []
            )
        }

        setTestModalDetector { _, _, _ in mockModalInfos }

        return JSONRPC.success(id: id, result: [
            "injected": true,
            "mockModalsCount": mockModalInfos.count
        ])
    }

    /// T16.0.5: 测试用 RPC - 清除 mock modal detector
    private func handleTestClearModalDetector(id: String, params: [String: Any]) -> String {
        clearTestModalDetector()
        return JSONRPC.success(id: id, result: ["cleared": true])
    }

    /// desktop.abort: 中止正在执行的请求
    private func handleAbort(id: String, params: [String: Any]) -> String {
        guard let meta = params["meta"] as? [String: Any],
              let requestId = meta["requestId"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing requestId in meta")
        }

        if abortRequest(requestId) {
            return JSONRPC.success(id: id, result: ["aborted": true])
        } else {
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Request not found or already aborted")
        }
    }

    // MARK: - T14.3A: UI 操作辅助方法

    /// 查找 UI 元素（根据 selector）
    private func findElement(selector: [String: Any]) -> AXUIElement? {
        // 检查 Accessibility 权限
        guard AXIsProcessTrusted() else {
            return nil
        }

        // 解析 selector 参数
        let selectorByRole = selector["byRole"] as? String
        let selectorTitleContains = selector["titleContains"] as? String
        let selectorValueContains = selector["valueContains"] as? String

        // 获取系统级 AX 元素
        let systemWideElement = AXUIElementCreateSystemWide()

        // 获取前台应用作为根元素
        var rootElement = systemWideElement
        if let frontmost = NSWorkspace.shared.frontmostApplication {
            let frontmostElement = AXUIElementCreateApplication(frontmost.processIdentifier)
            if copyAXValue(frontmostElement, attribute: kAXRoleAttribute) != nil {
                rootElement = frontmostElement
            }
        }

        // 遍历 AX 树查找元素
        var foundElement: AXUIElement? = nil

        func traverse(_ element: AXUIElement, depth: Int) {
            // 深度限制 20
            guard depth < 20 else { return }
            guard foundElement == nil else { return }  // 已找到，停止遍历

            // 提取元素属性
            let role = copyAXValue(element, attribute: kAXRoleAttribute) as? String
            let title = copyAXValue(element, attribute: kAXTitleAttribute) as? String
            let value = copyAXValue(element, attribute: kAXValueAttribute)

            // 检查匹配
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

            if matches {
                foundElement = element
                return
            }

            // 递归遍历子元素
            if let children = copyAXValue(element, attribute: kAXChildrenAttribute) as? [AXUIElement] {
                for child in children {
                    traverse(child, depth: depth + 1)
                    if foundElement != nil {
                        return
                    }
                }
            }
        }

        traverse(rootElement, depth: 0)
        return foundElement
    }

    /// 发送快捷键
    private func sendHotkey(modifiers: CGEventFlags, keyCode: UInt32) {
        let source = CGEventSource(stateID: .hidSystemState)

        // 创建按键按下事件
        if let keyDown = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(keyCode), keyDown: true) {
            keyDown.flags = modifiers
            keyDown.post(tap: .cghidEventTap)
        }

        // 小延迟
        Thread.sleep(forTimeInterval: 0.001)

        // 创建按键释放事件
        if let keyUp = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(keyCode), keyDown: false) {
            keyUp.flags = modifiers
            keyUp.post(tap: .cghidEventTap)
        }
    }

    /// 将字符转换为虚拟键码
    private func keyCodeForChar(_ char: Character) -> UInt32? {
        switch char {
        case "a": return UInt32(kVK_ANSI_A)
        case "b": return UInt32(kVK_ANSI_B)
        case "c": return UInt32(kVK_ANSI_C)
        case "d": return UInt32(kVK_ANSI_D)
        case "e": return UInt32(kVK_ANSI_E)
        case "f": return UInt32(kVK_ANSI_F)
        case "g": return UInt32(kVK_ANSI_G)
        case "h": return UInt32(kVK_ANSI_H)
        case "i": return UInt32(kVK_ANSI_I)
        case "j": return UInt32(kVK_ANSI_J)
        case "k": return UInt32(kVK_ANSI_K)
        case "l": return UInt32(kVK_ANSI_L)
        case "m": return UInt32(kVK_ANSI_M)
        case "n": return UInt32(kVK_ANSI_N)
        case "o": return UInt32(kVK_ANSI_O)
        case "p": return UInt32(kVK_ANSI_P)
        case "q": return UInt32(kVK_ANSI_Q)
        case "r": return UInt32(kVK_ANSI_R)
        case "s": return UInt32(kVK_ANSI_S)
        case "t": return UInt32(kVK_ANSI_T)
        case "u": return UInt32(kVK_ANSI_U)
        case "v": return UInt32(kVK_ANSI_V)
        case "w": return UInt32(kVK_ANSI_W)
        case "x": return UInt32(kVK_ANSI_X)
        case "y": return UInt32(kVK_ANSI_Y)
        case "z": return UInt32(kVK_ANSI_Z)
        case "0": return UInt32(kVK_ANSI_0)
        case "1": return UInt32(kVK_ANSI_1)
        case "2": return UInt32(kVK_ANSI_2)
        case "3": return UInt32(kVK_ANSI_3)
        case "4": return UInt32(kVK_ANSI_4)
        case "5": return UInt32(kVK_ANSI_5)
        case "6": return UInt32(kVK_ANSI_6)
        case "7": return UInt32(kVK_ANSI_7)
        case "8": return UInt32(kVK_ANSI_8)
        case "9": return UInt32(kVK_ANSI_9)
        case " ": return UInt32(kVK_Space)
        case "\n": return 36  // kVK_Return
        case "\t": return 48  // kVK_Tab
        case "\u{1B}": return 53  // kVK_Escape (ASCII 27 = ESC)
        default: return nil
        }
    }

    // MARK: - 截图辅助方法

    /// 捕获屏幕截图
    private func captureScreenshot() -> Data? {
        let mainScreen = NSScreen.main
        guard let frame = mainScreen?.frame else {
            return nil
        }

        let rect = CGRect(origin: .zero, size: frame.size)
        guard let cgImage = CGDisplayCreateImage(CGMainDisplayID(), rect: rect) else {
            return nil
        }

        let bitmapRep = NSBitmapImageRep(cgImage: cgImage)
        guard let pngData = bitmapRep.representation(using: .png, properties: [:]) else {
            return nil
        }

        return pngData
    }

    /// 构建 AX 树（简化版，仅用于 desktop.observe）
    private func buildAXTree(evidenceDir: String) -> [String: Any]? {
        // 检查 Accessibility 权限
        guard AXIsProcessTrusted() else {
            return nil
        }

        // 获取系统级 AX 元素
        let systemWideElement = AXUIElementCreateSystemWide()

        // 获取前台应用
        var frontmostApp: [String: Any]? = nil
        var frontmostAppElement: AXUIElement? = nil

        if let frontmost = NSWorkspace.shared.frontmostApplication {
            frontmostApp = [
                "bundleId": frontmost.bundleIdentifier ?? "",
                "pid": frontmost.processIdentifier
            ]
            frontmostAppElement = AXUIElementCreateApplication(frontmost.processIdentifier)
        }

        // 使用前台应用作为根元素，回退到系统级
        let unwrappedRootElement = frontmostAppElement ?? systemWideElement

        // 序列化 AX 树（简化版，深度限制 20，节点限制 1000）
        let maxDepth = 20
        let maxNodes = 1000
        var nodeCount = 0

        func serialize(_ element: AXUIElement, depth: Int) -> [String: Any]? {
            guard depth < maxDepth, nodeCount < maxNodes else {
                return nil
            }

            nodeCount += 1

            let role = copyAXValue(element, attribute: kAXRoleAttribute) as? String ?? "Unknown"
            var result: [String: Any] = ["role": role]

            // 提取常用属性
            let attrs: [(String, String)] = [
                ("AXTitle", kAXTitleAttribute),
                ("AXValue", kAXValueAttribute),
                ("AXPlaceholderValue", kAXPlaceholderValueAttribute)
            ]

            for (key, attr) in attrs {
                if let value = copyAXValue(element, attribute: attr) {
                    result[key] = value
                }
            }

            // 提取位置和大小
            if let position = copyAXValue(element, attribute: kAXPositionAttribute) as? [String: Any],
               let size = copyAXValue(element, attribute: kAXSizeAttribute) as? [String: Any] {
                result["frame"] = ["position": position, "size": size]
            }

            // 递归处理子元素（限制 20 个）
            if depth < 10 {
                if let children = copyAXValue(element, attribute: kAXChildrenAttribute) as? [AXUIElement] {
                    var childResults: [[String: Any]] = []
                    for child in children.prefix(20) {
                        if let childTree = serialize(child, depth: depth + 1) {
                            childResults.append(childTree)
                        }
                        if nodeCount >= maxNodes {
                            break
                        }
                    }
                    if !childResults.isEmpty {
                        result["children"] = childResults
                    }
                }
            }

            return result
        }

        let tree = serialize(unwrappedRootElement, depth: 0)

        // 落盘 ax.json
        var result: [String: Any] = [:]
        if let treeData = tree {
            result["tree"] = treeData
        }
        if let frontmost = frontmostApp {
            result["frontmost"] = frontmost
        }

        let axPath = "\(evidenceDir)/ax.json"
        do {
            let jsonData = try JSONSerialization.data(withJSONObject: result, options: .prettyPrinted)
            try jsonData.write(to: URL(fileURLWithPath: axPath))
            return result
        } catch {
            logger.error("Failed to write ax.json: \(error)")
            return nil
        }
    }

    /// 复制 AX 属性值
    private func copyAXValue(_ element: AXUIElement, attribute: String) -> Any? {
        var value: AnyObject?
        let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

        guard error == .success else {
            return nil
        }

        guard let unwrappedValue = value else {
            return nil
        }

        // 转换为 Swift 原生类型
        if let str = unwrappedValue as? String { return str }
        if let num = unwrappedValue as? Int { return num }
        if let num = unwrappedValue as? Double { return num }
        if let bool = unwrappedValue as? Bool { return bool }
        if let dict = unwrappedValue as? [String: Any] { return dict }

        // CFArray 转换
        if CFGetTypeID(unwrappedValue as CFTypeRef) == CFArrayGetTypeID() {
            let cfArray = unwrappedValue as! CFArray
            var result: [Any] = []
            let count = CFArrayGetCount(cfArray)
            for i in 0..<count {
                if let item = CFArrayGetValueAtIndex(cfArray, i) {
                    let axElement = unsafeBitCast(item, to: AXUIElement.self)
                    result.append(axElement)
                }
            }
            return result
        }

        // AXValue 转换
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

        return String(describing: unwrappedValue)
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

    /// 接收 JSON-RPC 请求并返回响应（T9.M0.2: 简化为直接调用 server.handleJsonRpc）
    func sendMessage(_ requestJson: String, reply: @escaping (String) -> Void) {
        logger.log("Received request: \(requestJson.prefix(100))...")

        // 检查 service 是否停止
        guard server.isAccepting else {
            reply(JSONRPC.error(id: "", code: BridgeError.hostStopped.code, message: "Host is stopped"))
            return
        }

        // T9.M0.2: 提取 peer 信息
        let peer = extractPeerIdentity()

        // T9.M0.2: 异步调用 server.handleJsonRpc（单一真相源）
        DispatchQueue.global(qos: .userInitiated).async { [weak server] in
            let response = server?.handleJsonRpc(requestJson: requestJson, peer: peer) ?? JSONRPC.error(id: "", code: BridgeError.internalError.code, message: "Server not available")
            reply(response)
        }
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
