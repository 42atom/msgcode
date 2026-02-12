#!/usr/bin/env swift
/**
 * Batch-T8.6.1.1 端到端验收测试
 * 验证 token 签发、single-use、过期
 */

import Foundation
import OSLog

// MARK: - XPC Protocol Definition
@objc(BridgeXPCProtocol)
public protocol BridgeXPCProtocol: NSObjectProtocol {
    @objc func sendMessage(_ requestJson: String, reply: @escaping (String) -> Void)
}

// 配置
let workspacePath = ProcessInfo.processInfo.environment["WORKSPACE"] ?? FileManager.default.currentDirectoryPath
let serviceName = "com.msgcode.desktop.bridge"

// XPC 连接
let connection = NSXPCConnection(machServiceName: serviceName)
connection.remoteObjectInterface = NSXPCInterface(with: BridgeXPCProtocol.self)
connection.resume()

// 辅助函数：打印输出（立即刷新）
func log(_ message: String) {
    print(message)
    fflush(stdout)
}

// 辅助函数：发送 JSON-RPC 请求
func sendRequest(_ method: String, params: [String: Any]) async -> [String: Any]? {
    let request: [String: Any] = [
        "jsonrpc": "2.0",
        "id": UUID().uuidString,
        "method": method,
        "params": params
    ]

    guard let requestData = try? JSONSerialization.data(withJSONObject: request),
          let requestString = String(data: requestData, encoding: .utf8) else {
        log("❌ Failed to serialize request")
        return nil
    }

    return await withCheckedContinuation { continuation in
        guard let proxy = connection.remoteObjectProxy as? BridgeXPCProtocol else {
            log("❌ Failed to get XPC proxy")
            continuation.resume(returning: nil)
            return
        }
        proxy.sendMessage(requestString) { response in
            if let data = response.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                continuation.resume(returning: json)
            } else {
                log("❌ Failed to parse response: \(response)")
                continuation.resume(returning: nil)
            }
        }
    }
}

// 辅助函数：提取错误码
func getErrorCode(_ response: [String: Any]?) -> String? {
    guard let error = response?["error"] as? [String: Any] else { return nil }
    return error["code"] as? String
}

// 辅助函数：JSON 字符串化
func jsonToString(_ dict: [String: Any]) -> String {
    if let data = try? JSONSerialization.data(withJSONObject: dict, options: [.prettyPrinted]),
       let str = String(data: data, encoding: .utf8) {
        return str
    }
    return String(describing: dict)
}

// 主测试流程
let semaphore = DispatchSemaphore(value: 0)

Task {
    log("=== Batch-T8.6.1.1 端到端验收测试 ===")

    // 测试 1: desktop.confirm.issue
    log("\n测试 1: desktop.confirm.issue 返回 token")
    let issueResponse = await sendRequest("desktop.confirm.issue", params: [
        "meta": [
            "schemaVersion": 1,
            "requestId": UUID().uuidString,
            "workspacePath": workspacePath,
            "timeoutMs": 10000
        ],
        "intent": [
            "method": "desktop.typeText",
            "params": [
                "text": "T8.6_OK"
            ]
        ],
        "ttlMs": 10000  // 10秒后过期
    ])

    guard let issueResult = issueResponse?["result"] as? [String: Any],
          let token = issueResult["token"] as? String,
          let expiresAt = issueResult["expiresAt"] as? String else {
        log("❌ 测试 1 失败：无法解析 issue 响应")
        log("响应: \(jsonToString(issueResponse ?? [:]))")
        semaphore.signal()
        exit(1)
    }

    log("✓ token: \(token)")
    log("✓ expiresAt: \(expiresAt)")

    // 测试 2: 用 token 执行 typeText（应成功并消费 token）
    log("\n测试 2: 用 token 执行 typeText（应成功并消费 token）")
    let typeTextResponse = await sendRequest("desktop.typeText", params: [
        "meta": [
            "schemaVersion": 1,
            "requestId": UUID().uuidString,
            "workspacePath": workspacePath,
            "timeoutMs": 10000
        ],
        "confirm": [
            "token": token
        ],
        "text": "T8.6_OK"
    ])

    log("响应: \(jsonToString(typeTextResponse ?? [:]))")

    if let error = getErrorCode(typeTextResponse) {
        log("❌ 测试 2 失败: \(error)")
        log("   可能原因：权限未授予或 token 无效")
        semaphore.signal()
        exit(1)
    } else if let result = typeTextResponse?["result"] as? [String: Any],
              let typed = result["typed"] as? Bool, typed {
        log("✓ 测试 2 通过: typeText 成功执行 (typed=true, tokenConsumed=true)")
    } else {
        log("❌ 测试 2 失败: 响应格式异常")
        semaphore.signal()
        exit(1)
    }

    // 测试 3: 同 token 再次使用 → DESKTOP_CONFIRM_REQUIRED（single-use）
    log("\n测试 3: 同 token 再次使用 → DESKTOP_CONFIRM_REQUIRED（single-use）")
    let reuseResponse = await sendRequest("desktop.typeText", params: [
        "meta": [
            "schemaVersion": 1,
            "requestId": UUID().uuidString,
            "workspacePath": workspacePath,
            "timeoutMs": 10000
        ],
        "confirm": [
            "token": token
        ],
        "text": "T8.6_OK"
    ])

    log("响应: \(jsonToString(reuseResponse ?? [:]))")

    if let error = getErrorCode(reuseResponse), error == "DESKTOP_CONFIRM_REQUIRED" {
        log("✓ 测试 3 通过: single-use 生效 (DESKTOP_CONFIRM_REQUIRED)")
    } else {
        log("❌ 测试 3 失败: 期望 DESKTOP_CONFIRM_REQUIRED，得到 \(getErrorCode(reuseResponse) ?? "SUCCESS")")
        semaphore.signal()
        exit(1)
    }

    // 测试 4: 新 token，等待过期后使用
    log("\n测试 4: token 过期检查（新 token，等待 2 秒）")
    let newIssueResponse = await sendRequest("desktop.confirm.issue", params: [
        "meta": [
            "schemaVersion": 1,
            "requestId": UUID().uuidString,
            "workspacePath": workspacePath,
            "timeoutMs": 10000
        ],
        "intent": [
            "method": "desktop.typeText",
            "params": [
                "text": "T8.6_EXPIRED"
            ]
        ],
        "ttlMs": 1500  // 1.5秒后过期
    ])

    guard let newResult = newIssueResponse?["result"] as? [String: Any],
          let newToken = newResult["token"] as? String else {
        log("❌ 测试 4 失败：无法签发新 token")
        semaphore.signal()
        exit(1)
    }

    log("✓ 新 token: \(newToken)")

    log("等待 2 秒（确保 token 过期）...")
    try await Task.sleep(nanoseconds: 2_000_000_000)

    log("使用过期 token...")
    let expiredResponse = await sendRequest("desktop.typeText", params: [
        "meta": [
            "schemaVersion": 1,
            "requestId": UUID().uuidString,
            "workspacePath": workspacePath,
            "timeoutMs": 10000
        ],
        "confirm": [
            "token": newToken
        ],
        "text": "T8.6_EXPIRED"
    ])

    log("响应: \(jsonToString(expiredResponse ?? [:]))")

    if let error = getErrorCode(expiredResponse), error == "DESKTOP_CONFIRM_REQUIRED" {
        log("✓ 测试 4 通过: token 过期检查 (DESKTOP_CONFIRM_REQUIRED)")
    } else {
        log("❌ 测试 4 失败: 期望 DESKTOP_CONFIRM_REQUIRED，得到 \(getErrorCode(expiredResponse) ?? "SUCCESS")")
        semaphore.signal()
        exit(1)
    }

    log("\n=== Batch-T8.6.1.1 验收测试全部通过 ===")
    log("\n验收要点：")
    log("1. ✓ 测试 1: token 签发成功")
    log("2. ✓ 测试 2: token 执行成功并被消费 (typed=true)")
    log("3. ✓ 测试 3: single-use 生效 (DESKTOP_CONFIRM_REQUIRED)")
    log("4. ✓ 测试 4: token 过期检查 (DESKTOP_CONFIRM_REQUIRED)")

    semaphore.signal()
    exit(0)
}

// 保持主线程运行
semaphore.wait()
