#!/bin/bash
# MsgcodeDesktopHost XPC 测试客户端
# 用于验证 com.msgcode.desktop.bridge 是否正常工作

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$SCRIPT_DIR/.build/test"
EXEC_NAME="test_client"

echo "🔨 编译测试客户端..."

# 创建测试目录
mkdir -p "$TEST_DIR"

# 编译测试客户端
swiftc -o "$TEST_DIR/$EXEC_NAME" -target arm64-apple-macosx14.0 \
    -sdk $(xcrun --sdk macosx --show-sdk-path) \
    -F $(xcrun --sdk macosx --show-sdk-path)/System/Library/Frameworks \
    - << 'SWIFT_EOF'
//
//  test_client.swift
//  MsgcodeDesktopBridge XPC 测试客户端
//

import Foundation
import Cocoa

// MARK: - XPC Protocol

@objc(BridgeXPCProtocol)
public protocol BridgeXPCProtocol: NSObjectProtocol {
    @objc func sendMessage(_ requestJson: String, reply: @escaping (String) -> Void)
}

// MARK: - JSON-RPC Helper

struct JSONRPC {
    static func request(id: String, method: String, params: [String: Any]) -> String {
        let request: [String: Any] = [
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: request, options: []),
              let string = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return string
    }

    static func parse(_ json: String) -> [String: Any]? {
        guard let data = json.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return dict
    }
}

// MARK: - Test Client

func testHealth(connection: NSXPCConnection) -> Bool {
    print("\n📋 测试 desktop.health...")

    guard let proxy = connection.remoteObjectProxy as? BridgeXPCProtocol else {
        print("❌ 无法获取 XPC proxy")
        return false
    }

    let requestId = UUID().uuidString
    let request = JSONRPC.request(id: requestId, method: "desktop.health", params: ["meta": [
        "schemaVersion": 1,
        "requestId": UUID().uuidString,
        "workspacePath": "/tmp",
        "timeoutMs": 5000
    ]])

    let semaphore = DispatchSemaphore(value: 0)
    var success = false

    proxy.sendMessage(request) { response in
        if let dict = JSONRPC.parse(response),
           let result = dict["result"] as? [String: Any] {
            print("✅ desktop.health 成功")
            if let hostVersion = result["hostVersion"] as? String {
                print("   hostVersion: \(hostVersion)")
            }
            if let permissions = result["permissions"] as? [String: Any] {
                print("   permissions: \(permissions)")
            }
            success = true
        } else {
            print("❌ desktop.health 失败")
            print("   response: \(response)")
        }
        semaphore.signal()
    }

    semaphore.wait()
    return success
}

func testDoctor(connection: NSXPCConnection) -> Bool {
    print("\n🩺 测试 desktop.doctor...")

    guard let proxy = connection.remoteObjectProxy as? BridgeXPCProtocol else {
        print("❌ 无法获取 XPC proxy")
        return false
    }

    let requestId = UUID().uuidString
    let request = JSONRPC.request(id: requestId, method: "desktop.doctor", params: ["meta": [
        "schemaVersion": 1,
        "requestId": UUID().uuidString,
        "workspacePath": "/tmp",
        "timeoutMs": 5000
    ]])

    let semaphore = DispatchSemaphore(value: 0)
    var success = false

    proxy.sendMessage(request) { response in
        if let dict = JSONRPC.parse(response),
           let result = dict["result"] as? [String: Any] {
            print("✅ desktop.doctor 成功")
            if let permissions = result["permissions"] as? [String: Any] {
                print("   permissions: \(permissions)")
            }
            if let issues = result["issues"] as? [String] {
                print("   issues: \(issues.isEmpty ? "none" : issues.joined(separator: ", "))")
            }
            if let healthy = result["healthy"] as? Bool {
                print("   healthy: \(healthy)")
            }
            success = true
        } else {
            print("❌ desktop.doctor 失败")
            print("   response: \(response)")
        }
        semaphore.signal()
    }

    semaphore.wait()
    return success
}

func testObserve(connection: NSXPCConnection, workspacePath: String) -> Bool {
    print("\n📸 测试 desktop.observe...")

    guard let proxy = connection.remoteObjectProxy as? BridgeXPCProtocol else {
        print("❌ 无法获取 XPC proxy")
        return false
    }

    let requestId = UUID().uuidString
    let request = JSONRPC.request(id: requestId, method: "desktop.observe", params: ["meta": [
        "schemaVersion": 1,
        "requestId": UUID().uuidString,
        "workspacePath": workspacePath,
        "timeoutMs": 5000
    ], "route": [
        "app": ["bundleId": "com.apple.Safari"],
        "focusPolicy": "focusIfNeeded"
    ], "options": [
        "includeScreenshot": true,
        "includeAxTree": true
    ]])

    let semaphore = DispatchSemaphore(value: 0)
    var success = false

    proxy.sendMessage(request) { response in
        if let dict = JSONRPC.parse(response),
           let result = dict["result"] as? [String: Any] {
            print("✅ desktop.observe 成功")
            if let executionId = result["executionId"] as? String {
                print("   executionId: \(executionId)")
            }
            if let evidence = result["evidence"] as? [String: Any] {
                print("   evidence: \(evidence)")
            }
            success = true
        } else {
            print("❌ desktop.observe 失败")
            print("   response: \(response)")
        }
        semaphore.signal()
    }

    semaphore.wait()
    return success
}

// MARK: - Main

print("🔗 连接到 XPC Service: com.msgcode.desktop.bridge")

let connection = NSXPCConnection(machServiceName: "com.msgcode.desktop.bridge", options: [])
connection.remoteObjectInterface = NSXPCInterface(with: BridgeXPCProtocol.self)
connection.resume()

var passCount = 0
var totalCount = 0

// Test 1: health
totalCount += 1
if testHealth(connection: connection) {
    passCount += 1
}

// Test 2: doctor
totalCount += 1
if testDoctor(connection: connection) {
    passCount += 1
}

// Test 3: observe (with workspace path)
totalCount += 1
let workspacePath = ProcessInfo.processInfo.environment["MSGCODE_DESKTOP_WORKSPACE_PATH"]
    ?? FileManager.default.currentDirectoryPath
print("\n📁 测试 desktop.observe (workspace: \(workspacePath))...")
if testObserve(connection: connection, workspacePath: workspacePath) {
    passCount += 1
}

// 验证证据目录
print("\n📂 验证证据目录...")
let dateFormatter = DateFormatter()
dateFormatter.dateFormat = "yyyy-MM-dd"
let dateStr = dateFormatter.string(from: Date())
let evidenceBaseDir = "\(workspacePath)/artifacts/desktop/\(dateStr)"

if FileManager.default.fileExists(atPath: evidenceBaseDir) {
    print("✅ 证据目录存在: \(evidenceBaseDir)")
    if let contents = try? FileManager.default.contentsOfDirectory(atPath: evidenceBaseDir) {
        print("   子目录: \(contents)")
        // 检查最新的执行目录
        if let latestDir = contents.sorted().last,
           let envPath = "\(evidenceBaseDir)/\(latestDir)/env.json" as String?,
           FileManager.default.fileExists(atPath: envPath) {
            print("✅ env.json 存在: \(envPath)")
        }
    }
} else {
    print("⚠️  证据目录不存在: \(evidenceBaseDir)")
}

connection.invalidate()

print("\n" + String(repeating: "=", count: 50))
print("测试结果: \(passCount)/\(totalCount) 通过")
print(String(repeating: "=", count: 50))

exit(passCount == totalCount ? 0 : 1)
SWIFT_EOF

echo "✅ 编译完成"
echo ""
echo "🔧 运行测试客户端..."
echo ""
echo "⚠️  注意：请确保 MsgcodeDesktopHost.app 已运行且 Start Bridge 已点击"
echo ""

# 运行测试
export MSGCODE_DESKTOP_WORKSPACE_PATH="${1:-$(pwd)}"
"$TEST_DIR/$EXEC_NAME"

echo ""
echo "完成！"
