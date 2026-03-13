//
//  ConfigLoader.swift
//  MsgcodeDesktopHost - 配置加载器
//
// 读取并合并 Menubar 配置（workspace 级 + 用户级 + 默认值）
//

import Cocoa
import OSLog

// MARK: - 配置模型

struct MenubarConfig: Codable {
    let enabled: Bool
    let workspacePath: String?
    let shortcuts: ShortcutsConfig?
    let openEvidence: OpenEvidenceConfig?

    // 默认值
    static let `default` = MenubarConfig(
        enabled: true,
        workspacePath: nil,
        shortcuts: nil,
        openEvidence: nil
    )

    // 合并策略：非 nil 值覆盖
    func merge(other: MenubarConfig) -> MenubarConfig {
        return MenubarConfig(
            enabled: other.enabled,  // Bool 类型，直接使用
            workspacePath: other.workspacePath ?? self.workspacePath,
            shortcuts: other.shortcuts ?? self.shortcuts,
            openEvidence: other.openEvidence ?? self.openEvidence
        )
    }
}

struct ShortcutsConfig: Codable {
    let doctor: String?
    let observe: String?
    let openEvidence: String?

    static let `default` = ShortcutsConfig(
        doctor: "cmd+d",
        observe: "cmd+o",
        openEvidence: "cmd+e"
    )
}

struct OpenEvidenceConfig: Codable {
    let mode: String  // "latest" | "choose"

    static let `default` = OpenEvidenceConfig(
        mode: "latest"
    )
}

// MARK: - 配置加载器

class ConfigLoader {
    private let logger = Logger(subsystem: "com.msgcode.desktop.host", category: "config")

    // 配置文件名
    private let configFileName = "config.json"
    private let msgcodeSubdir = ".msgcode"

    // 单例
    static let shared = ConfigLoader()

    private init() {}

    // 加载配置（合并 workspace 级 + 用户级 + 默认值）
    func loadConfig(currentWorkspacePath: String?) -> MenubarConfig {
        var config = MenubarConfig.default

        // 1. 尝试加载用户级配置
        if let userConfig = loadConfig(from: userConfigPath()) {
            config = config.merge(other: userConfig)
            logger.log("加载用户级配置: \(userConfig.workspacePath ?? "default")")
        }

        // 2. 尝试加载 workspace 级配置
        if let workspaceConfig = loadConfig(from: workspaceConfigPath(currentWorkspacePath)) {
            config = config.merge(other: workspaceConfig)
            logger.log("加载 workspace 级配置: \(workspaceConfig.workspacePath ?? "default")")
        }

        // 解析 workspacePath（创建新实例以保持 struct 不可变性）
        if let resolvedPath = resolveWorkspacePath(config: config, currentWorkspacePath: currentWorkspacePath) {
            config = MenubarConfig(
                enabled: config.enabled,
                workspacePath: resolvedPath,
                shortcuts: config.shortcuts,
                openEvidence: config.openEvidence
            )
        }

        return config
    }

    // 加载配置文件（支持多种格式）
    private func loadConfig(from path: String?) -> MenubarConfig? {
        guard let path = path else { return nil }

        guard FileManager.default.fileExists(atPath: path) else {
            return nil
        }

        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))

            // 格式 1: 直接 MenubarConfig { "enabled": true, ... }
            if let config = try? JSONDecoder().decode(MenubarConfig.self, from: data) {
                return config
            }

            // 格式 2: 嵌套 { "desktop": { "menubar": { ... } } }
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let desktop = json["desktop"] as? [String: Any],
               let menubar = desktop["menubar"] as? [String: Any],
               let menubarData = try? JSONSerialization.data(withJSONObject: menubar) {
                return try JSONDecoder().decode(MenubarConfig.self, from: menubarData)
            }

            // 格式 3: 点号分隔字段（文档定义格式）从 desktop.menubar.* 提取
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                var menubarDict: [String: Any] = [:]
                var shortcutsDict: [String: String] = [:]
                var openEvidenceDict: [String: Any] = [:]

                for (key, value) in json {
                    if key.hasPrefix("desktop.menubar.") {
                        let subKey = String(key.dropFirst("desktop.menubar.".count))

                        // 处理嵌套 shortcuts 和 openEvidence
                        if subKey.hasPrefix("shortcuts.") {
                            let shortcutKey = String(subKey.dropFirst("shortcuts.".count))
                            if let strValue = value as? String {
                                shortcutsDict[shortcutKey] = strValue
                            }
                        } else if subKey.hasPrefix("openEvidence.") {
                            let evidenceKey = String(subKey.dropFirst("openEvidence.".count))
                            openEvidenceDict[evidenceKey] = value
                        } else {
                            menubarDict[subKey] = value
                        }
                    }
                }

                if !shortcutsDict.isEmpty {
                    menubarDict["shortcuts"] = shortcutsDict
                }
                if !openEvidenceDict.isEmpty {
                    menubarDict["openEvidence"] = openEvidenceDict
                }

                if !menubarDict.isEmpty, let menubarData = try? JSONSerialization.data(withJSONObject: menubarDict) {
                    return try JSONDecoder().decode(MenubarConfig.self, from: menubarData)
                }
            }

            return nil
        } catch {
            logger.error("配置文件解析失败: \(path) - \(error.localizedDescription)")
            return nil
        }
    }

    // 配置文件路径
    private func userConfigPath() -> String? {
        let configDir = FileManager.default.homeDirectoryForCurrentUser
            return configDir.appendingPathComponent(".config/msgcode").appendingPathComponent(configFileName).path
    }

    private func workspaceConfigPath(_ workspacePath: String?) -> String? {
        guard let workspacePath = workspacePath else { return nil }
        return URL(fileURLWithPath: workspacePath)
            .appendingPathComponent(msgcodeSubdir)
            .appendingPathComponent(configFileName)
            .path
    }

    // 解析 workspacePath
    private func resolveWorkspacePath(config: MenubarConfig, currentWorkspacePath: String?) -> String? {
        // 如果配置中明确指定了路径，使用配置的路径
        if let configuredPath = config.workspacePath, !configuredPath.isEmpty {
            return configuredPath
        }

        // 否则使用当前进程启动目录
        return currentWorkspacePath ?? FileManager.default.currentDirectoryPath
    }
}
