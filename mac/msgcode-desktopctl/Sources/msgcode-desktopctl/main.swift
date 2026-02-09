//
//  main.swift
//  msgcode-desktopctl
//
//  msgcode Desktop Bridge CLI 客户端
//  Batch-T6.0: ping/doctor 支持 --workspace 参数
//

import Foundation
import ArgumentParser

// MARK: - Entry Point

@main
struct EntryPoint {
    static func main() {
        _ = MsgcodeDesktopctlMain()
    }
}

// MARK: - CLI Wrapper

struct MsgcodeDesktopctlMain {
    init() {
        do {
            try MsgcodeDesktopctl.main()
        } catch {
            exit(1)
        }
    }
}

// MARK: - Exit Codes

enum ExitCode: Int32, Error {
    case success = 0
    case rpcError = 2
    case connectionFailed = 10
}

// MARK: - Main CLI Structure

struct MsgcodeDesktopctl: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "msgcode-desktopctl",
        abstract: "msgcode Desktop Bridge CLI 客户端",
        discussion: "通过 XPC 与 MsgcodeDesktopBridge 服务通信",
        version: "0.1.0",
        subcommands: [Ping.self, Doctor.self, IssueConfirm.self, Observe.self, Find.self, Click.self, TypeText.self, Hotkey.self, WaitUntil.self, Abort.self, AbortDemo.self, Rpc.self, Session.self]
    )

    func run() throws {
        throw CleanExit.message("请使用子命令：ping, doctor, observe")
    }
}

// MARK: - Ping Command

extension MsgcodeDesktopctl {
    struct Ping: ParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "检查 Bridge 服务是否运行",
            discussion: "调用 desktop.health 方法"
        )

        @Option(
            name: .long,
            help: "Workspace 绝对路径（默认为当前工作目录）"
        )
        var workspace: String?

        func run() throws {
            // 使用 PWD 作为默认 workspace
            let workspacePath = workspace ?? FileManager.default.currentDirectoryPath

            // 验证 workspace 路径
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: workspacePath, isDirectory: &isDirectory), isDirectory.boolValue else {
                FileHandle.standardError.write("Error: Workspace path does not exist or is not a directory: \(workspacePath)\n".data(using: .utf8)!)
                throw ExitCode.connectionFailed
            }

            let requestId = JSONRPC.generateId()
            let request = JSONRPC.request(id: requestId, method: "desktop.health", params: [
                "meta": [
                    "schemaVersion": 1,
                    "requestId": requestId,
                    "workspacePath": workspacePath,
                    "timeoutMs": 5000
                ]
            ])

            execute(request: request)
        }
    }
}

// MARK: - Doctor Command

extension MsgcodeDesktopctl {
    struct Doctor: ParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "诊断 Bridge 服务状态",
            discussion: "调用 desktop.doctor 方法，返回详细的权限诊断信息"
        )

        @Option(
            name: .long,
            help: "Workspace 绝对路径（默认为当前工作目录）"
        )
        var workspace: String?

        func run() throws {
            // 使用 PWD 作为默认 workspace
            let workspacePath = workspace ?? FileManager.default.currentDirectoryPath

            // 验证 workspace 路径
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: workspacePath, isDirectory: &isDirectory), isDirectory.boolValue else {
                FileHandle.standardError.write("Error: Workspace path does not exist or is not a directory: \(workspacePath)\n".data(using: .utf8)!)
                throw ExitCode.connectionFailed
            }

            let requestId = JSONRPC.generateId()
            let request = JSONRPC.request(id: requestId, method: "desktop.doctor", params: [
                "meta": [
                    "schemaVersion": 1,
                    "requestId": requestId,
                    "workspacePath": workspacePath,
                    "timeoutMs": 5000
                ]
            ])

            execute(request: request)
        }
    }
}

// MARK: - IssueConfirm Command (T8.6.2)

extension MsgcodeDesktopctl {
    struct IssueConfirm: ParsableCommand {
        static let configuration = CommandConfiguration(
            commandName: "issue-confirm",
            abstract: "签发一次性确认 token",
            discussion: "调用 desktop.confirm.issue 方法，返回 token 用于后续操作确认"
        )

        @Argument(help: "Workspace 绝对路径")
        var workspacePath: String

        @Option(name: .long, help: "目标方法名（如 desktop.typeText）")
        var method: String

        @Option(name: .long, help: "方法参数 JSON 字符串（如 '{\"text\":\"hello\"}'）")
        var paramsJson: String

        @Option(name: .long, help: "Token 有效期（毫秒），默认 60000")
        var ttlMs: Int = 60000

        func run() throws {
            // 验证 workspace 路径
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: workspacePath, isDirectory: &isDirectory), isDirectory.boolValue else {
                FileHandle.standardError.write("Error: Workspace path does not exist or is not a directory: \(workspacePath)\n".data(using: .utf8)!)
                throw ExitCode.connectionFailed
            }

            // 解析 params-json
            guard let paramsData = paramsJson.data(using: .utf8),
                  let intentParams = try? JSONSerialization.jsonObject(with: paramsData) as? [String: Any] else {
                FileHandle.standardError.write("Error: Invalid --params-json, must be valid JSON\n".data(using: .utf8)!)
                throw ExitCode.connectionFailed
            }

            let requestId = JSONRPC.generateId()
            let request = JSONRPC.request(id: requestId, method: "desktop.confirm.issue", params: [
                "meta": [
                    "schemaVersion": 1,
                    "requestId": requestId,
                    "workspacePath": workspacePath,
                    "timeoutMs": 10000
                ],
                "intent": [
                    "method": method,
                    "params": intentParams
                ],
                "ttlMs": ttlMs
            ])

            execute(request: request)
        }
    }
}

// MARK: - Observe Command

extension MsgcodeDesktopctl {
    struct Observe: ParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "观察桌面状态并落盘证据",
            discussion: "调用 desktop.observe 方法，截图并记录 AX 树"
        )

        @Argument(help: "Workspace 绝对路径")
        var workspacePath: String

        @Option(name: .long, help: "超时时间（毫秒），默认 60000")
        var timeoutMs: Int = 60000


        func run() throws {
            // 验证 workspace 路径
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: workspacePath, isDirectory: &isDirectory), isDirectory.boolValue else {
                FileHandle.standardError.write("Error: Workspace path does not exist or is not a directory: \(workspacePath)\n".data(using: .utf8)!)
                throw ExitCode.connectionFailed
            }

            let requestId = JSONRPC.generateId()
            let request = JSONRPC.request(id: requestId, method: "desktop.observe", params: [
                "meta": [
                    "schemaVersion": 1,
                    "requestId": requestId,
                    "workspacePath": workspacePath,
                    "timeoutMs": timeoutMs
                ],
                "route": [
                    "app": ["bundleId": ""],
                    "focusPolicy": "focusIfNeeded"
                ],
                "options": [
                    "includeScreenshot": true,
                    "includeAxTree": true
                ]
            ])

            execute(request: request)
        }
    }
}

// MARK: - Find Command

extension MsgcodeDesktopctl {
    struct Find: ParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "查找 UI 元素",
            discussion: "调用 desktop.find 方法，按 selector 搜索并返回候选 elementRefs"
        )

        @Argument(help: "Workspace 绝对路径")
        var workspacePath: String

        @Option(name: .long, help: "按角色精确匹配（如 AXButton）")
        var byRole: String?

        @Option(name: .long, help: "按标题包含匹配")
        var titleContains: String?

        @Option(name: .long, help: "按值包含匹配")
        var valueContains: String?

        @Option(name: .long, help: "最多返回 N 个候选（默认 10）")
        var limit: Int?

        func run() throws {
            // 验证 workspace 路径
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: workspacePath, isDirectory: &isDirectory), isDirectory.boolValue else {
                FileHandle.standardError.write("Error: Workspace path does not exist or is not a directory: \(workspacePath)\n".data(using: .utf8)!)
                throw ExitCode.connectionFailed
            }

            var selector: [String: Any] = [:]
            if let byRole = byRole { selector["byRole"] = byRole }
            if let titleContains = titleContains { selector["titleContains"] = titleContains }
            if let valueContains = valueContains { selector["valueContains"] = valueContains }
            if let limit = limit { selector["limit"] = limit }

            let requestId = JSONRPC.generateId()
            var params: [String: Any] = [
                "meta": [
                    "schemaVersion": 1,
                    "requestId": requestId,
                    "workspacePath": workspacePath,
                    "timeoutMs": 10000
                ]
            ]
            if !selector.isEmpty {
                params["selector"] = selector
            }

            let request = JSONRPC.request(id: requestId, method: "desktop.find", params: params)

            execute(request: request)
        }
    }
}

// MARK: - Click Command

extension MsgcodeDesktopctl {
    struct Click: ParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "点击 UI 元素",
            discussion: "调用 desktop.click 方法，需要 confirm 确认"
        )

        @Argument(help: "Workspace 绝对路径")
        var workspacePath: String

        @Option(name: .long, help: "按角色精确匹配（如 AXButton）")
        var byRole: String?

        @Option(name: .long, help: "按标题包含匹配")
        var titleContains: String?

        @Option(name: .long, help: "一次性确认 token（优先于 --confirm）")
        var confirmToken: String?

        @Option(name: .long, help: "确认短语（必须为 'CONFIRM' 或 'CONFIRM:<requestId>'）")
        var confirm: String?

        func run() throws {
            var selector: [String: Any] = [:]
            if let byRole = byRole { selector["byRole"] = byRole }
            if let titleContains = titleContains { selector["titleContains"] = titleContains }

            let requestId = JSONRPC.generateId()
            var confirmDict: [String: Any] = [:]

            // 优先使用 token
            if let token = confirmToken {
                confirmDict["token"] = token
            } else if let phrase = confirm {
                confirmDict["phrase"] = phrase
            } else {
                FileHandle.standardError.write("Error: --confirm-token or --confirm is required\n".data(using: .utf8)!)
                throw ExitCode.connectionFailed
            }

            let params: [String: Any] = [
                "meta": [
                    "schemaVersion": 1,
                    "requestId": requestId,
                    "workspacePath": workspacePath,
                    "timeoutMs": 10000
                ],
                "confirm": confirmDict,
                "target": [
                    "selector": selector
                ]
            ]

            let request = JSONRPC.request(id: requestId, method: "desktop.click", params: params)
            execute(request: request)
        }
    }
}

// MARK: - TypeText Command

extension MsgcodeDesktopctl {
    struct TypeText: ParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "输入文本",
            discussion: "调用 desktop.typeText 方法，通过剪贴板粘贴，需要 confirm 确认"
        )

        @Argument(help: "Workspace 绝对路径")
        var workspacePath: String

        @Argument(help: "要输入的文本")
        var text: String

        @Option(name: .long, help: "按角色精确匹配目标元素（可选）")
        var byRole: String?

        @Option(name: .long, help: "按标题包含匹配目标元素（可选）")
        var titleContains: String?

        @Option(name: .long, help: "一次性确认 token（优先于 --confirm）")
        var confirmToken: String?

        @Option(name: .long, help: "确认短语（必须为 'CONFIRM' 或 'CONFIRM:<requestId>'）")
        var confirm: String?

        func run() throws {
            var target: [String: Any] = [:]
            if byRole != nil || titleContains != nil {
                var selector: [String: Any] = [:]
                if let byRole = byRole { selector["byRole"] = byRole }
                if let titleContains = titleContains { selector["titleContains"] = titleContains }
                target["selector"] = selector
            }

            let requestId = JSONRPC.generateId()
            var confirmDict: [String: Any] = [:]

            // 优先使用 token
            if let token = confirmToken {
                confirmDict["token"] = token
            } else if let phrase = confirm {
                confirmDict["phrase"] = phrase
            } else {
                FileHandle.standardError.write("Error: --confirm-token or --confirm is required\n".data(using: .utf8)!)
                throw ExitCode.connectionFailed
            }

            var params: [String: Any] = [
                "meta": [
                    "schemaVersion": 1,
                    "requestId": requestId,
                    "workspacePath": workspacePath,
                    "timeoutMs": 10000
                ],
                "confirm": confirmDict,
                "text": text
            ]
            if !target.isEmpty {
                params["target"] = target
            }

            let request = JSONRPC.request(id: requestId, method: "desktop.typeText", params: params)
            execute(request: request)
        }
    }
}

// MARK: - Hotkey Command

extension MsgcodeDesktopctl {
    struct Hotkey: ParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "发送快捷键",
            discussion: "调用 desktop.hotkey 方法，需要 confirm 确认"
        )

        @Argument(help: "Workspace 绝对路径")
        var workspacePath: String

        @Argument(help: "快捷键组合（如 cmd+v, enter, cmd+enter）")
        var keys: String

        @Option(name: .long, help: "一次性确认 token（优先于 --confirm）")
        var confirmToken: String?

        @Option(name: .long, help: "确认短语（必须为 'CONFIRM' 或 'CONFIRM:<requestId>'）")
        var confirm: String?

        func run() throws {
            // 解析快捷键：支持 "cmd+v", "enter", "cmd+enter" 格式
            let keyList = keys.split(separator: "+").map { $0.trimmingCharacters(in: .whitespaces) }

            let requestId = JSONRPC.generateId()
            var confirmDict: [String: Any] = [:]

            // 优先使用 token
            if let token = confirmToken {
                confirmDict["token"] = token
            } else if let phrase = confirm {
                confirmDict["phrase"] = phrase
            } else {
                FileHandle.standardError.write("Error: --confirm-token or --confirm is required\n".data(using: .utf8)!)
                throw ExitCode.connectionFailed
            }

            let params: [String: Any] = [
                "meta": [
                    "schemaVersion": 1,
                    "requestId": requestId,
                    "workspacePath": workspacePath,
                    "timeoutMs": 10000
                ],
                "confirm": confirmDict,
                "keys": keyList
            ]

            let request = JSONRPC.request(id: requestId, method: "desktop.hotkey", params: params)
            execute(request: request)
        }
    }
}

// MARK: - WaitUntil Command

extension MsgcodeDesktopctl {
    struct WaitUntil: ParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "等待 UI 条件成立",
            discussion: "调用 desktop.waitUntil 方法，轮询查找元素直到命中或超时"
        )

        @Argument(help: "Workspace 绝对路径")
        var workspacePath: String

        @Option(name: .long, help: "按角色精确匹配（如 AXButton）")
        var byRole: String?

        @Option(name: .long, help: "按标题包含匹配")
        var titleContains: String?

        @Option(name: .long, help: "按值包含匹配")
        var valueContains: String?

        @Option(name: .long, help: "超时时间（毫秒），默认 15000")
        var timeoutMs: Int?

        @Option(name: .long, help: "轮询间隔（毫秒），默认 500")
        var pollMs: Int?

        func run() throws {
            var selector: [String: Any] = [:]
            if let byRole = byRole { selector["byRole"] = byRole }
            if let titleContains = titleContains { selector["titleContains"] = titleContains }
            if let valueContains = valueContains { selector["valueContains"] = valueContains }

            guard !selector.isEmpty else {
                FileHandle.standardError.write("Error: At least one selector condition is required\n".data(using: .utf8)!)
                throw ExitCode.connectionFailed
            }

            let requestId = JSONRPC.generateId()
            var params: [String: Any] = [
                "meta": [
                    "schemaVersion": 1,
                    "requestId": requestId,
                    "workspacePath": workspacePath,
                    "timeoutMs": timeoutMs ?? 15000
                ],
                "condition": [
                    "selectorExists": selector
                ],
                "timeoutMs": timeoutMs ?? 15000,
                "pollMs": pollMs ?? 500
            ]

            let request = JSONRPC.request(id: requestId, method: "desktop.waitUntil", params: params)
            execute(request: request)
        }
    }
}

// MARK: - Abort Command

extension MsgcodeDesktopctl {
    struct Abort: ParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "中止指定请求",
            discussion: "调用 desktop.abort 方法，中止正在执行的长请求（如 waitUntil）"
        )

        @Argument(help: "Workspace 绝对路径")
        var workspacePath: String

        @Argument(help: "要中止的请求 ID（JSON-RPC id）")
        var targetRequestId: String

        func run() throws {
            let requestId = JSONRPC.generateId()
            let params: [String: Any] = [
                "meta": [
                    "schemaVersion": 1,
                    "requestId": requestId,
                    "workspacePath": workspacePath,
                    "timeoutMs": 5000
                ],
                "targetRequestId": targetRequestId
            ]

            let request = JSONRPC.request(id: requestId, method: "desktop.abort", params: params)
            execute(request: request)
        }
    }
}

// MARK: - AbortDemo Command (T8.3.1: 端到端 abort 验证)

extension MsgcodeDesktopctl {
    struct AbortDemo: ParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "演示 abort 功能（端到端验证）",
            discussion: "在同一进程内启动 waitUntil 然后 abort 它，验证 DESKTOP_ABORTED 返回"
        )

        @Argument(help: "Workspace 绝对路径")
        var workspacePath: String

        func run() throws {
            print("=== Batch-T8.3.1 Abort 端到端演示 ===", terminator: "\n")
            print()

            // 生成固定的 requestId 用于演示
            let demoRequestId = "demo-wait-\(UUID().uuidString)"
            print("1. 启动 waitUntil (requestId: \(demoRequestId))")
            print("   timeout: 60000ms, selector: AXButton + 'NeverExistsXYZ123'")
            print()

            // 创建 waitUntil 请求
            let waitParams: [String: Any] = [
                "meta": [
                    "schemaVersion": 1,
                    "requestId": demoRequestId,
                    "workspacePath": workspacePath,
                    "timeoutMs": 60000
                ],
                "condition": [
                    "selectorExists": [
                        "byRole": "AXButton",
                        "titleContains": "NeverExistsXYZ123"
                    ]
                ],
                "timeoutMs": 60000,
                "pollMs": 500
            ]

            let waitRequest = JSONRPC.request(id: demoRequestId, method: "desktop.waitUntil", params: waitParams)

            // 创建 XPC 连接（同一进程，复用连接）
            let client = XPCClient()
            let waitSemaphore = DispatchSemaphore(value: 0)
            var waitResponse: String?
            var waitCompleted = false

            // 发送 waitUntil 请求（异步）
            print("2. 发送 waitUntil 请求...")
            client.send(waitRequest) { result in
                switch result {
                case .success(let response):
                    waitResponse = response
                    waitCompleted = true
                case .failure(let error):
                    waitResponse = "{\"error\": \"\(error.localizedDescription)\"}"
                    waitCompleted = true
                }
                waitSemaphore.signal()
            }

            // 等待 500ms 让 waitUntil 启动
            print("3. 等待 500ms 让 waitUntil 启动...")
            Thread.sleep(forTimeInterval: 0.5)
            print()

            // 发送 abort 请求
            let abortRequestId = UUID().uuidString
            print("4. 发送 abort 请求 (targetRequestId: \(demoRequestId))")

            let abortParams: [String: Any] = [
                "meta": [
                    "schemaVersion": 1,
                    "requestId": abortRequestId,
                    "workspacePath": workspacePath,
                    "timeoutMs": 5000
                ],
                "targetRequestId": demoRequestId
            ]

            let abortRequest = JSONRPC.request(id: abortRequestId, method: "desktop.abort", params: abortParams)

            // 使用同一个 client 发送 abort（同步）
            let abortSemaphore = DispatchSemaphore(value: 0)
            var abortResponse: String?

            client.send(abortRequest) { result in
                switch result {
                case .success(let response):
                    abortResponse = response
                case .failure(let error):
                    abortResponse = "{\"error\": \"\(error.localizedDescription)\"}"
                }
                abortSemaphore.signal()
            }

            // 等待 abort 完成
            _ = abortSemaphore.wait(timeout: .now() + 5)

            if let abortResp = abortResponse {
                print("5. Abort 响应:")
                // 格式化输出 JSON
                if let data = abortResp.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    if let pretty = try? JSONSerialization.data(withJSONObject: json, options: .prettyPrinted),
                       let prettyString = String(data: pretty, encoding: .utf8) {
                        print(prettyString)
                    } else {
                        print(abortResp)
                    }
                } else {
                    print(abortResp)
                }
                print()
            }

            // 等待 waitUntil 完成（最多 5 秒，因为应该被 abort 中止）
            print("6. 等待 waitUntil 完成...")
            _ = waitSemaphore.wait(timeout: .now() + 5)

            if let waitResp = waitResponse {
                print("7. WaitUntil 最终响应:")
                // 格式化输出 JSON
                if let data = waitResp.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                    if let pretty = try? JSONSerialization.data(withJSONObject: json, options: .prettyPrinted),
                       let prettyString = String(data: pretty, encoding: .utf8) {
                        print(prettyString)
                    } else {
                        print(waitResp)
                    }
                } else {
                    print(waitResp)
                }
                print()

                // 验证结果
                print("=== 验证结果 ===")
                if let data = waitResp.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let error = json["error"] as? [String: Any],
                   let code = error["code"] as? String {
                    if code == "DESKTOP_ABORTED" {
                        print("✓ 验收通过: waitUntil 返回 DESKTOP_ABORTED")
                    } else {
                        print("✗ 验收失败: waitUntil 返回 \(code)")
                    }
                } else {
                    print("? 无法解析响应")
                }
            } else {
                print("✗ waitUntil 无响应")
            }
        }
    }
}

// MARK: - Rpc Command (T8.4: 通用 RPC 透传)

extension MsgcodeDesktopctl {
    struct Rpc: ParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "通用 RPC 透传",
            discussion: "直接调用 desktop bridge 的任意方法，支持 params-json 透传"
        )

        @Argument(help: "Workspace 绝对路径")
        var workspacePath: String

        @Option(name: .long, help: "RPC 方法名（如 desktop.find）")
        var method: String

        @Option(name: .long, help: "参数 JSON 字符串（如 '{\"selector\":{\"byRole\":\"AXWindow\"}}'）")
        var paramsJson: String

        func run() throws {
            // 解析 params-json
            guard let paramsData = paramsJson.data(using: .utf8),
                  let params = try? JSONSerialization.jsonObject(with: paramsData) as? [String: Any] else {
                FileHandle.standardError.write("Error: Invalid --params-json, must be valid JSON\n".data(using: .utf8)!)
                throw ExitCode.connectionFailed
            }

            // 确保 meta 存在，如果未提供则自动构建
            let requestId = JSONRPC.generateId()
            var finalParams = params

            if finalParams["meta"] == nil {
                finalParams["meta"] = [
                    "schemaVersion": 1,
                    "requestId": requestId,
                    "workspacePath": workspacePath,
                    "timeoutMs": 10000
                ]
            }

            // 如果 meta 有 workspacePath，优先使用命令行参数
            if var meta = finalParams["meta"] as? [String: Any] {
                meta["workspacePath"] = workspacePath
                finalParams["meta"] = meta
            }

            let request = JSONRPC.request(id: requestId, method: method, params: finalParams)
            execute(request: request)
        }
    }
}

// MARK: - Common Execute Function

func execute(request: String) -> Never {
    let client = XPCClient()
    let semaphore = DispatchSemaphore(value: 0)
    var exitCode: ExitCode = .success

    client.send(request) { result in
        switch result {
        case .success(let response):
            // 检查是否为 JSON-RPC error
            if let errorResponse = JSONRPC.parseError(response) {
                FileHandle.standardOutput.write(errorResponse.data(using: .utf8)!)
                exitCode = .rpcError
            } else {
                FileHandle.standardOutput.write(response.data(using: .utf8)!)
                exitCode = .success
            }

        case .failure(let error):
            let errorMessage = error.localizedDescription
            FileHandle.standardError.write("Error: \(errorMessage)\n".data(using: .utf8)!)
            exitCode = .connectionFailed
        }

        semaphore.signal()
    }

    semaphore.wait()
    exit(exitCode.rawValue)
}

// MARK: - XPC Client

class XPCClient {
    private let logger = Log.shared
    private var connection: NSXPCConnection?

    init() {}

    func send(_ request: String, completion: @escaping (Result<String, Error>) -> Void) {
        logger.debug("Sending XPC request...")

        let connection = NSXPCConnection(machServiceName: "com.msgcode.desktop.bridge", options: [])
        connection.remoteObjectInterface = NSXPCInterface(with: BridgeXPCProtocol.self)

        var handlerCalled = false
        connection.interruptionHandler = { [weak connection] in
            self.logger.debug("XPC connection interrupted")
            if !handlerCalled {
                handlerCalled = true
                connection?.invalidate()
                completion(.failure(NSError(domain: "com.msgcode.desktop.bridge", code: 10,
                    userInfo: [NSLocalizedDescriptionKey: "XPC connection interrupted"])))
            }
        }

        connection.invalidationHandler = { [weak connection] in
            self.logger.debug("XPC connection invalidated")
            if !handlerCalled {
                handlerCalled = true
                completion(.failure(NSError(domain: "com.msgcode.desktop.bridge", code: 10,
                    userInfo: [NSLocalizedDescriptionKey: "XPC connection failed"])))
            }
        }

        connection.resume()
        self.connection = connection

        guard let proxy = connection.remoteObjectProxy as? BridgeXPCProtocol else {
            self.logger.error("Failed to create XPC proxy")
            handlerCalled = true
            connection.invalidate()
            completion(.failure(NSError(domain: "com.msgcode.desktop.bridge", code: 10,
                userInfo: [NSLocalizedDescriptionKey: "Failed to create XPC proxy"])))
            return
        }

        logger.debug("Sending message...")
        proxy.sendMessage(request) { [weak connection] response in
            self.logger.debug("Received response")
            handlerCalled = true
            connection?.invalidate()
            completion(.success(response))
        }
    }
}

// MARK: - XPC Protocol

@objc(BridgeXPCProtocol)
protocol BridgeXPCProtocol: NSObjectProtocol {
    @objc func sendMessage(_ requestJson: String, reply: @escaping (String) -> Void)
}

// MARK: - Logger

class Log {
    static let shared = Log()

    private init() {}

    func debug(_ message: String) {
        // DEBUG mode disabled for production
    }

    func error(_ message: String) {
        FileHandle.standardError.write("[ERROR] \(message)\n".data(using: .utf8)!)
    }
}

// MARK: - JSONRPC

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

    static func generateId() -> String {
        return UUID().uuidString
    }

    static func parseError(_ response: String) -> String? {
        guard let data = response.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let _ = dict["error"] as? [String: Any] else {
            return nil
        }
        return response
    }
}

// MARK: - Session Command (T8.6.4.0: stdio 长连接模式)

extension MsgcodeDesktopctl {
    struct Session: ParsableCommand {
        static let configuration = CommandConfiguration(
            abstract: "长连接 session 模式（stdio NDJSON）",
            discussion: "创建单一 XPC 连接，循环处理 stdin 的 NDJSON 请求，60s idle 自动退出"
        )

        @Argument(help: "Workspace 绝对路径")
        var workspacePath: String

        @Option(name: .long, help: "Idle 超时时间（毫秒），默认 60000")
        var idleMs: Int = 60000

        func run() throws {
            // 验证 workspace 路径
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: workspacePath, isDirectory: &isDirectory), isDirectory.boolValue else {
                FileHandle.standardError.write("Error: Workspace path does not exist or is not a directory: \(workspacePath)\n".data(using: .utf8)!)
                throw ExitCode.connectionFailed
            }

            // 创建单一 XPC 连接（复用）
            let client = SessionClient(idleTimeoutMs: idleMs)

            // 启动 idle 计时器
            client.startIdleTimer()

            // 循环读 stdin（行分隔的 NDJSON）
            let stdin = FileHandle.standardInput
            var lineBuffer = Data()

            while true {
                // 检查 idle 超时
                if client.shouldExit {
                    client.log("Idle timeout, exiting session")
                    // T8.6.4.2: 清理 XPC 连接后再退出
                    client.cleanup()
                    throw ExitCode.success  // 使用 throw 退出
                }

                // 读取 stdin（使用 availableData 非阻塞读取）
                let data = stdin.availableData

                if data.isEmpty {
                    // 无数据，短暂等待
                    Thread.sleep(forTimeInterval: 0.01)
                    continue
                }

                // 追加到行缓冲
                lineBuffer.append(data)

                // 处理完整行
                while let newlineIndex = lineBuffer.firstIndex(of: UInt8(ascii: "\n")) {
                    let lineData = lineBuffer[0..<newlineIndex]
                    lineBuffer.removeSubrange(0...newlineIndex)

                    if let line = String(data: lineData, encoding: .utf8), !line.isEmpty {
                        // 重置 idle 计时器
                        client.resetIdleTimer()

                        // 处理请求
                        client.processRequest(line: line)
                    }
                }
            }
        }
    }
}

// MARK: - Session Client (T8.6.4.0: 单一 XPC 连接 + 单飞队列)

class SessionClient {
    private let logger = Log.shared
    private let idleTimeoutMs: Int
    private let idleTimeoutSeconds: TimeInterval
    private var lastActivityAt: Date
    private var shouldExitFlag = false

    // 单飞队列：同一时间只处理一个 in-flight 请求
    private let queue = DispatchQueue(label: "com.msgcode.desktopctl.session")
    private var isProcessing = false

    // T8.6.4.2: 缓存单一 XPC 连接，确保 peer 稳定
    private var xpcConnection: NSXPCConnection?
    private var xpcProxy: BridgeXPCProtocol?

    init(idleTimeoutMs: Int) {
        self.idleTimeoutMs = idleTimeoutMs
        self.idleTimeoutSeconds = TimeInterval(idleTimeoutMs) / 1000.0
        self.lastActivityAt = Date()
    }

    // T8.6.4.2: 清理 XPC 连接
    deinit {
        invalidateConnection()
    }

    // MARK: - XPC 连接管理（T8.6.4.2）

    // MARK: - Idle 管理

    func startIdleTimer() {
        // 在后台线程定期检查 idle 超时
        queue.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let self = self else { return }
            if self.shouldExitFlag {
                return
            }
            self.checkIdleTimeout()
            // 递归重启计时器
            self.startIdleTimer()
        }
    }

    func resetIdleTimer() {
        lastActivityAt = Date()
    }

    func checkIdleTimeout() {
        let now = Date()
        let idleTime = now.timeIntervalSince(lastActivityAt)
        if idleTime > idleTimeoutSeconds {
            shouldExitFlag = true
        }
    }

    var shouldExit: Bool {
        return shouldExitFlag
    }

    // MARK: - XPC 连接管理（T8.6.4.2）

    /// 获取或创建缓存的 XPC 连接
    private func getOrCreateConnection() -> BridgeXPCProtocol? {
        // 检查现有连接是否可用
        if let proxy = xpcProxy, let connection = xpcConnection {
            return proxy
        }

        // 创建新连接
        let connection = NSXPCConnection(machServiceName: "com.msgcode.desktop.bridge", options: [])
        connection.remoteObjectInterface = NSXPCInterface(with: BridgeXPCProtocol.self)

        // 设置中断处理器
        connection.interruptionHandler = { [weak self] in
            self?.log("XPC connection interrupted")
            self?.invalidateConnection()
        }

        // 设置失效处理器
        connection.invalidationHandler = { [weak self] in
            self?.log("XPC connection invalidated")
            self?.invalidateConnection()
        }

        connection.resume()

        guard let proxy = connection.remoteObjectProxy as? BridgeXPCProtocol else {
            log("Failed to create XPC proxy")
            connection.invalidate()
            return nil
        }

        xpcConnection = connection
        xpcProxy = proxy

        log("Created new XPC connection (peer will be stable)")
        return proxy
    }

    /// 清理 XPC 连接
    private func invalidateConnection() {
        if let connection = xpcConnection {
            connection.invalidate()
            xpcConnection = nil
            xpcProxy = nil
            log("XPC connection invalidated")
        }
    }

    /// T8.6.4.2: 清理资源（session 退出前调用）
    func cleanup() {
        invalidateConnection()
    }

    // MARK: - 请求处理（单飞队列）

    func processRequest(line: String) {
        // 使用单飞队列确保串行处理
        queue.async { [weak self] in
            guard let self = self else { return }

            // 等待上一个请求完成
            while self.isProcessing {
                Thread.sleep(forTimeInterval: 0.001)
            }

            self.isProcessing = true
            defer { self.isProcessing = false }

            self.handleRequest(line: line)
        }
    }

    private func handleRequest(line: String) {
        // 解析 NDJSON 请求
        guard let data = line.data(using: .utf8),
              let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            log("Invalid JSON request: \(line)")
            return
        }

        guard let id = request["id"] as? String,
              let method = request["method"] as? String,
              let params = request["params"] as? [String: Any] else {
            log("Missing required fields in request: \(line)")
            return
        }

        // 生成 JSON-RPC request
        let requestId = JSONRPC.generateId()
        var finalParams = params

        // 确保 meta 存在
        if finalParams["meta"] == nil {
            finalParams["meta"] = [
                "schemaVersion": 1,
                "requestId": requestId,
                "timeoutMs": request["timeoutMs"] ?? 10000
            ] as [String: Any]
        }

        // 注入 workspacePath 和 requestId
        if var meta = finalParams["meta"] as? [String: Any] {
            meta["workspacePath"] = request["workspacePath"]
            meta["requestId"] = id  // 使用请求的 id 作为 requestId
            finalParams["meta"] = meta
        }

        let rpcRequest = JSONRPC.request(id: id, method: method, params: finalParams)

        // 发送到 Bridge（同步等待）
        let semaphore = DispatchSemaphore(value: 0)
        var exitCode: ExitCode = .success
        var stdout = ""
        var stderr = ""

        // T8.6.4.2: 使用缓存的 XPC 连接，确保 peer 稳定
        guard let proxy = getOrCreateConnection() else {
            exitCode = .connectionFailed
            stderr = "Failed to get XPC connection"
            writeResponse(id: id, exitCode: exitCode, stdout: "", stderr: stderr)
            semaphore.signal()
            _ = semaphore.wait()
            return
        }

        var handlerCalled = false

        proxy.sendMessage(rpcRequest) { response in
            handlerCalled = true

            // T8.6.4.2: 不再 invalidate 连接，保持连接复用

            // 检查是否为 JSON-RPC error
            if JSONRPC.parseError(response) != nil {
                exitCode = .rpcError
            }
            stdout = response
            semaphore.signal()
        }

        // 等待响应（使用请求的 timeoutMs）
        let timeoutMs = request["timeoutMs"] as? Int ?? 10000
        let timeoutResult = semaphore.wait(timeout: .now() + .milliseconds(timeoutMs))

        if timeoutResult == .timedOut {
            handlerCalled = true
            // T8.6.4.2: 超时时也保持连接，只标记失败
            exitCode = .connectionFailed
            stderr = "Request timeout"
        }

        // 写入 NDJSON 响应
        writeResponse(id: id, exitCode: exitCode, stdout: stdout, stderr: stderr)
    }

    private func writeResponse(id: String, exitCode: ExitCode, stdout: String, stderr: String) {
        let response: [String: Any] = [
            "id": id,
            "exitCode": exitCode.rawValue,
            "stdout": stdout,
            "stderr": stderr
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: response, options: []),
              let jsonString = String(data: data, encoding: .utf8) else {
            log("Failed to serialize response")
            return
        }

        // 使用 FileHandle 写入 stdout
        let outputData = (jsonString + "\n").data(using: .utf8)!
        FileHandle.standardOutput.write(outputData)
    }

    func log(_ message: String) {
        // 日志走 stderr，避免污染 stdout JSON 流
        FileHandle.standardError.write("[Session] \(message)\n".data(using: .utf8)!)
    }
}
