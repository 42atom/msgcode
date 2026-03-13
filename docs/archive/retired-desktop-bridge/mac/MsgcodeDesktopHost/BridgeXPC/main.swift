//
//  main.swift
//  MsgcodeDesktopBridge (XPC Service)
//
//  Service name: com.msgcode.desktop.bridge
//  Protocol: JSON-RPC 2.0
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

// MARK: - Peer Identity

/// Peer 身份信息：从 XPC connection 提取
struct PeerIdentity {
    let pid: pid_t
    let auditTokenDigest: String
    let signingId: String?
    let teamId: String?
}

// MARK: - Bridge Service

/// XPC Service 主类：接收并处理 JSON-RPC 请求
class BridgeService: NSObject, NSXPCListenerDelegate {
    private let logger = Logger(subsystem: "com.msgcode.desktop.bridge", category: "XPC")
    private var listener: NSXPCListener?
    var isAccepting = false  // 内部访问控制
    private var activeRequests: Set<String> = []

    // MARK: - Service Lifecycle

    /// 启动 XPC Service（XPC 调用入口）
    func startService() {
        logger.log("Bridge XPC Service starting...")

        // 创建 Mach service listener
        let listener = NSXPCListener(machServiceName: "com.msgcode.desktop.bridge")
        listener.delegate = self
        self.listener = listener

        // 开始接受连接
        listener.resume()
        isAccepting = true

        logger.log("Bridge XPC Service started and accepting connections")
    }

    /// 停止接受新连接（Stop）
    func stopAccepting() {
        isAccepting = false
        logger.log("Bridge XPC Service stopped accepting new connections")
    }

    /// Panic: 停止接受新连接并中止当前请求
    func panic() {
        isAccepting = false
        logger.log("Bridge XPC Service PANIC: stopping all operations")

        // 等待当前请求完成（最多 5 秒）
        let deadline = Date().addingTimeInterval(5)
        while !activeRequests.isEmpty && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.1)
        }

        if !activeRequests.isEmpty {
            logger.error("Panic: some requests did not complete in time")
        }
    }

    // MARK: - NSXPCListenerDelegate

    public func listener(_ listener: NSXPCListener, shouldAcceptNewConnection newConnection: NSXPCConnection) -> Bool {
        // 检查是否接受新连接
        guard isAccepting else {
            logger.log("Rejecting connection: service not accepting")
            return false
        }

        // 配置连接
        newConnection.exportedInterface = NSXPCInterface(with: BridgeXPCProtocol.self)
        newConnection.exportedObject = BridgeXPCAdapter(bridge: self, connection: newConnection)
        newConnection.resume()

        logger.log("Accepted new XPC connection")
        return true
    }

    /// 注册活动请求（用于 single-flight abort）
    func registerRequest(_ id: String) {
        activeRequests.insert(id)
    }

    /// 注销请求
    func unregisterRequest(_ id: String) {
        activeRequests.remove(id)
    }

    /// 检查请求是否被中止
    func isRequestAborted(_ id: String) -> Bool {
        return !isAccepting && activeRequests.contains(id)
    }
}

// MARK: - XPC Adapter

/// XPC 适配器：将 XPC 调用转发到 BridgeService
class BridgeXPCAdapter: NSObject, BridgeXPCProtocol {
    private let bridge: BridgeService
    private let logger = Logger(subsystem: "com.msgcode.desktop.bridge", category: "Adapter")
    private let connection: NSXPCConnection
    private var cachedPeerIdentity: PeerIdentity?

    init(bridge: BridgeService, connection: NSXPCConnection) {
        self.bridge = bridge
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
        // auditToken 是 Data 类型，包含 8 个字节
        var auditTokenData = Data()

        // 尝试通过 KVC 获取 auditToken（这是 XPC 内部实现）
        if let token = connection.value(forKey: "auditToken") as? Data {
            auditTokenData = token
        } else {
            // 备选方案：使用 pid 作为 fallback
            logger.log("Warning: Could not extract auditToken, using pid as fallback")
            var pidBytes = pid.bigEndian
            auditTokenData = Data(bytes: &pidBytes, count: MemoryLayout<pid_t>.size)
        }

        // 计算 auditTokenDigest（SHA256，取前 16 字符作为摘要）
        let digest = auditTokenData.sha256().prefix(8).map { String(format: "%02x", $0) }.joined()

        // signingId 和 teamId：需要从 Code Signing 查询
        // TODO: [P1 技术债] 实现从进程提取 Code Signing 信息（需要使用 cs API）
        // 目的：实现可分发、可控的 allowlist（基于签名 ID 而非 PID）
        // 参考：man csreq, SecCodeCopySigningInformation
        // 当前：allowlist 已支持 pid:* 规则，功能完整
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
        // 规则格式：pid:<pid> 或 signingId:<identifier> 或 teamId:<teamid> 或 *
        let allowed = callers.contains { rule in
            if rule == "*" {
                return true  // 通配符允许所有
            }
            if rule.hasPrefix("pid:") {
                let ruleStr = rule.dropFirst(4)
                if let targetPid = pid_t(ruleStr) {
                    return peer.pid == targetPid
                }
            }
            if rule.hasPrefix("signingId:") {
                let signingId = String(rule.dropFirst(10))
                return peer.signingId == signingId
            }
            if rule.hasPrefix("teamId:") {
                let teamId = String(rule.dropFirst(7))
                return peer.teamId == teamId
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
        guard bridge.isAccepting else {
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
        bridge.registerRequest(id)

        // 处理请求（异步，避免阻塞 XPC 线程）
        DispatchQueue.global(qos: .userInitiated).async { [weak bridge] in
            let response = self.handleRequest(id: id, method: method, params: params)
            bridge?.unregisterRequest(id)
            reply(response)
        }
    }

    /// 处理具体方法
    private func handleRequest(id: String, method: String, params: [String: Any]) -> String {
        switch method {
        case "desktop.health":
            return handleHealth(id: id, params: params)
        case "desktop.doctor":
            return handleDoctor(id: id, params: params)
        case "desktop.observe":
            return handleObserve(id: id, params: params)
        default:
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Unknown method: \(method)")
        }
    }

    // MARK: - P0 方法实现

    /// desktop.health: 返回 Host 版本和权限状态
    private func handleHealth(id: String, params: [String: Any]) -> String {
        // meta 是必需的，但 health 不需要使用它
        guard params["meta"] is [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing meta")
        }

        let accessibility = AXIsProcessTrusted()
        let screenRecording = CGPreflightScreenCaptureAccess()

        // 获取 peer 信息（T8.6.4.1: peer 稳定性证据）
        let peer = extractPeerIdentity()
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
    private func handleDoctor(id: String, params: [String: Any]) -> String {
        // params 不使用，但保持接口一致性
        let accessibility = AXIsProcessTrusted()
        let screenRecording = CGPreflightScreenCaptureAccess()

        var issues: [String] = []
        if !accessibility {
            issues.append("Accessibility permission denied")
        }
        if !screenRecording {
            issues.append("Screen Recording permission denied")
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
            "healthy": issues.isEmpty
        ]

        return JSONRPC.success(id: id, result: result)
    }

    // MARK: - T7.0 辅助函数

    /// 截取屏幕截图
    /// - Returns: PNG 格式的 Data，失败返回 nil
    private func captureScreenshot() -> Data? {
        // 检查 Screen Recording 权限
        guard CGPreflightScreenCaptureAccess() else {
            logger.log("Screen Recording permission denied")
            return nil
        }

        // 获取主显示器 ID
        let displayId = CGMainDisplayID()

        // 截取屏幕图像
        guard let image = CGDisplayCreateImage(displayId) else {
            logger.log("Failed to capture display image")
            return nil
        }

        // 转换为 NSImage
        let nsImage = NSImage(cgImage: image, size: NSZeroSize)

        // 转换为 PNG Data
        guard let tiffData = nsImage.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiffData),
              let pngData = bitmap.representation(using: .png, properties: [:]) else {
            logger.log("Failed to convert screenshot to PNG")
            return nil
        }

        return pngData
    }

    /// 序列化 AX 树为 JSON
    /// - Returns: AX 树的字典表示，失败返回 nil
    private func serializeAXTree() -> [String: Any]? {
        // 检查 Accessibility 权限
        guard AXIsProcessTrusted() else {
            logger.log("Accessibility permission denied")
            return nil
        }

        // T7.1: 遍历边界配置（统一限制参数）
        let maxDepth = 50           // 最大深度（防止无限递归）
        let maxNodes = 5000         // 最大节点数（防止数据爆炸）
        let childLimit = 50         // 每节点子元素上限（防止单节点爆炸）
        let wallClockTimeoutMs = 10000  // 墙钟超时 10 秒（防止挂死）

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

        // 获取系统级 AX 元素
        let systemElement = AXUIElementCreateSystemWide()

        // 序列化 AX 树（有界遍历）
        let tree = serializeAXElement(
            systemElement,
            role: "System",
            depth: 0,
            maxDepth: maxDepth,
            maxNodes: maxNodes,
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

        return result
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

    /// 递归序列化 AX 元素（T7.1: 有界遍历）
    /// - Parameters:
    ///   - element: AXUIElement 对象
    ///   - role: 元素角色
    ///   - depth: 当前深度
    ///   - maxDepth: 最大深度（防止无限递归）
    ///   - maxNodes: 最大节点数（防止数据爆炸）
    ///   - deadline: 超时截止时间
    ///   - traversal: 遍历状态（inout）
    /// - Returns: 序列化后的字典，失败返回 nil
    private func serializeAXElement(
        _ element: AXUIElement,
        role: String,
        depth: Int,
        maxDepth: Int,
        maxNodes: Int,
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
        // 只在前 20 层提取子元素（平衡深度和广度）
        if depth < 20 {
            var children: [[String: Any]] = []

            if let childrenValue = copyAXValue(element, attribute: kAXChildrenAttribute) as? [Any] {
                // T7.1: 统一限制参数 - 每节点子元素最多 50 个（childLimit）
                let limit = min(childrenValue.count, 50)

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

    /// 复制 AX 属性值
    /// - Parameters:
    ///   - element: AXUIElement 对象
    ///   - attribute: 属性名
    /// - Returns: 属性值（支持基本类型、字符串、数组、字典）
    private func copyAXValue(_ element: AXUIElement, attribute: String) -> Any? {
        var value: AnyObject?
        let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)

        guard error == .success else {
            return nil
        }

        // 检查 value 是否为 nil
        guard let unwrappedValue = value else {
            return nil
        }

        // 直接将 value 转换为 Swift 原生类型
        // AX API 返回的 CF 类型已经桥接到 Swift
        if let str = unwrappedValue as? String {
            return str
        }

        if let num = unwrappedValue as? Int {
            return num
        }

        if let num = unwrappedValue as? Double {
            return num
        }

        if let bool = unwrappedValue as? Bool {
            return bool
        }

        if let array = unwrappedValue as? [Any] {
            return array
        }

        if let dict = unwrappedValue as? [String: Any] {
            return dict
        }

        // 兜底：返回字符串表示
        return String(describing: unwrappedValue)
    }

    /// desktop.observe: 截图 + AX 树，落盘证据
    private func handleObserve(id: String, params: [String: Any]) -> String {
        guard let meta = params["meta"] as? [String: Any] else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing meta")
        }

        guard let workspacePath = meta["workspacePath"] as? String else {
            return JSONRPC.error(id: id, code: BridgeError.invalidRequest.code, message: "Missing workspacePath")
        }

        // TODO: WORKSPACE_ROOT 校验（T3.3）

        let executionId = UUID().uuidString
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let dateStr = dateFormatter.string(from: Date())

        let evidenceDir = "\(workspacePath)/artifacts/desktop/\(dateStr)/\(executionId)"

        // 创建证据目录
        do {
            try FileManager.default.createDirectory(atPath: evidenceDir, withIntermediateDirectories: true)
        } catch {
            return JSONRPC.error(id: id, code: BridgeError.internalError.code, message: "Failed to create evidence directory: \(error)")
        }

        // T5.0: 提取 peer 身份信息
        let peer = extractPeerIdentity()

        // Host 信息
        let hostPid = ProcessInfo.processInfo.processIdentifier
        let hostBundleId = Bundle.main.bundleIdentifier ?? "com.msgcode.desktop.bridge"
        let hostVersion = "0.1.0"

        // 落盘 env.json（P0 验收要求 + T5.0 peer identity）
        let envPath = "\(evidenceDir)/env.json"
        var peerData: [String: Any] = [
            "pid": peer.pid,
            "auditTokenDigest": peer.auditTokenDigest
        ]
        // 只写入非 nil 的可选字段
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
                "version": hostVersion
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

        // T7.0: 检查权限状态
        let accessibilityGranted = AXIsProcessTrusted()
        let screenRecordingGranted = CGPreflightScreenCaptureAccess()
        var permissionsMissing: [String] = []
        if !accessibilityGranted { permissionsMissing.append("accessibility") }
        if !screenRecordingGranted { permissionsMissing.append("screenRecording") }

        // T7.0: 截图 (observe.png) - 诚实返回
        var screenshotPath: String? = nil
        if screenRecordingGranted {
            let path = "\(evidenceDir)/observe.png"
            if let screenshot = captureScreenshot() {
                do {
                    try screenshot.write(to: URL(fileURLWithPath: path))
                    logger.log("Screenshot saved to: \(path)")
                    screenshotPath = "observe.png"
                } catch {
                    logger.error("Failed to save screenshot: \(error)")
                }
            }
        }

        // T7.0: AX 树 (ax.json) - 诚实返回
        var axPath: String? = nil
        if accessibilityGranted {
            let path = "\(evidenceDir)/ax.json"
            if let axTree = serializeAXTree() {
                do {
                    let axData = try JSONSerialization.data(withJSONObject: axTree, options: [.prettyPrinted])
                    try axData.write(to: URL(fileURLWithPath: path))
                    logger.log("AX tree saved to: \(path)")
                    axPath = "ax.json"
                } catch {
                    logger.error("Failed to save AX tree: \(error)")
                }
            }
        }

        // T7.0: 构建 evidence 返回（诚实：只返回实际生成的文件）
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

        // T7.0: 添加权限缺失信息
        if !permissionsMissing.isEmpty {
            evidence["permissionsMissing"] = permissionsMissing
        }

        let result: [String: Any] = [
            "executionId": executionId,
            "evidence": evidence
        ]

        return JSONRPC.success(id: id, result: result)
    }
}

// MARK: - XPC Service Entry Point

/// XPC Service 入口
func main() {
    let service = BridgeService()
    service.startService()

    // 保持运行（XPC Service 由系统管理生命周期）
    RunLoop.main.run()
}

main()
