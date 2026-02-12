//
//  BridgeXPCProtocol.swift
//  MsgcodeDesktopBridge
//
//  XPC Service Protocol: JSON-RPC 2.0 over XPC
//  Service name: com.msgcode.desktop.bridge
//

import Foundation

/// XPC 协议：JSON-RPC 2.0 消息传递
/// Client 通过此接口发送 JSON-RPC request，接收 JSON-RPC response
@objc(BridgeXPCProtocol)
public protocol BridgeXPCProtocol: NSObjectProtocol {
    /// 发送 JSON-RPC 请求
    /// - Parameters:
    ///   - requestJson: JSON-RPC 2.0 request string
    ///   - reply: JSON-RPC 2.0 response string
    @objc func sendMessage(_ requestJson: String, reply: @escaping (String) -> Void)
}

/// XPC 错误码（对应 contract 中的错误码）
public enum BridgeError: Int, Error {
    case hostNotReady = 1
    case permissionMissing = 2
    case workspaceForbidden = 3
    case confirmRequired = 4
    case elementNotFound = 5
    case timeout = 6
    case aborted = 7
    case internalError = 8
    case invalidRequest = 9
    case hostStopped = 10
    case callerNotAllowed = 11  // T5: allowlist 验证失败
    case pathNotFound = 12      // T16.0.4: byPath 路径未命中
    case pathVerificationFailed = 13  // T16.0.4: byPath 验证失败
    case anchorNotFound = 14    // T16.0.3: near 锚点未找到
    case modalBlocking = 15      // T16.0.5: Modal 窗口阻塞操作

    public var code: String {
        switch self {
        case .hostNotReady: return "DESKTOP_HOST_NOT_READY"
        case .permissionMissing: return "DESKTOP_PERMISSION_MISSING"
        case .workspaceForbidden: return "DESKTOP_WORKSPACE_FORBIDDEN"
        case .confirmRequired: return "DESKTOP_CONFIRM_REQUIRED"
        case .elementNotFound: return "DESKTOP_ELEMENT_NOT_FOUND"
        case .timeout: return "DESKTOP_TIMEOUT"
        case .aborted: return "DESKTOP_ABORTED"
        case .internalError: return "DESKTOP_INTERNAL_ERROR"
        case .invalidRequest: return "DESKTOP_INVALID_REQUEST"
        case .hostStopped: return "DESKTOP_HOST_STOPPED"
        case .callerNotAllowed: return "DESKTOP_CALLER_NOT_ALLOWED"
        case .pathNotFound: return "DESKTOP_PATH_NOT_FOUND"
        case .pathVerificationFailed: return "DESKTOP_PATH_VERIFICATION_FAILED"
        case .anchorNotFound: return "DESKTOP_ANCHOR_NOT_FOUND"
        case .modalBlocking: return "DESKTOP_MODAL_BLOCKING"
        }
    }
}

/// JSON-RPC 2.0 工具
public struct JSONRPC {
    /// 构建 JSON-RPC error response
    public static func error(id: String, code: String, message: String, details: [String: Any]? = nil) -> String {
        var errorDict: [String: Any] = [
            "code": code,
            "message": message
        ]
        if let details = details {
            errorDict["details"] = details
        }
        let response: [String: Any] = [
            "jsonrpc": "2.0",
            "id": id,
            "error": errorDict
        ]
        return toJSON(response)
    }

    /// 构建 JSON-RPC success response
    public static func success(id: String, result: [String: Any]) -> String {
        let response: [String: Any] = [
            "jsonrpc": "2.0",
            "id": id,
            "result": result
        ]
        return toJSON(response)
    }

    /// 解析 JSON-RPC request
    public static func parseRequest(_ json: String) -> (id: String, method: String, params: [String: Any])? {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = dict["id"] as? String,
              let method = dict["method"] as? String,
              let params = dict["params"] as? [String: Any] else {
            return nil
        }
        return (id, method, params)
    }

    /// Dictionary to JSON string
    private static func toJSON(_ dict: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: dict, options: [.prettyPrinted]),
              let string = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return string
    }
}
