//
//  HighlightOverlay.swift
//  MsgcodeDesktopHost - 元素高亮显示
//
//  T16.0.5: 用于调试时高亮显示目标元素
//

import Cocoa
import OSLog

/// T16.0.5: 高亮覆盖层管理器（单例）
/// 使用 Overlay Window 方式在屏幕上绘制高亮边框
class HighlightOverlay {
    static let shared = HighlightOverlay()

    private let logger = Logger(subsystem: "com.msgcode.desktop.host", category: "Highlight")

    private var overlayWindow: NSWindow?
    private var highlightViews: [NSView] = []
    private var cleanupTimers: [Timer] = []

    private init() {}

    /// 显示高亮边框
    /// - Parameters:
    ///   - frame: 目标元素的屏幕坐标
    ///   - duration: 持续时间（秒）
    ///   - color: 边框颜色（默认红色）
    func showHighlight(frame: CGRect, duration: TimeInterval = 1.2, color: NSColor = NSColor.red) {
        DispatchQueue.main.async { [weak self] in
            self?.showHighlightOnMainThread(frame: frame, duration: duration, color: color)
        }
    }

    private func showHighlightOnMainThread(frame: CGRect, duration: TimeInterval, color: NSColor) {
        // 确保有 overlay window
        ensureOverlayWindow()

        guard let window = overlayWindow else {
            logger.error("Failed to create overlay window")
            return
        }

        // 创建高亮视图
        let highlightView = NSView(frame: frame)
        highlightView.wantsLayer = true

        // 设置边框
        highlightView.layer?.borderColor = color.cgColor
        highlightView.layer?.borderWidth = 3.0
        highlightView.layer?.cornerRadius = 4.0

        // 设置半透明填充
        highlightView.layer?.backgroundColor = color.withAlphaComponent(0.2).cgColor

        // 添加到 overlay window
        window.contentView?.addSubview(highlightView)
        highlightViews.append(highlightView)

        // 设置窗口级别为 floating（显示在最上层）
        window.level = .floating

        logger.log("Showing highlight at x=\(Int(frame.minX)) y=\(Int(frame.minY)) w=\(Int(frame.width)) h=\(Int(frame.height)) for \(duration)s")

        // 设置定时清理
        let timer = Timer.scheduledTimer(withTimeInterval: duration, repeats: false) { [weak self] _ in
            self?.clearHighlight(highlightView)
        }
        cleanupTimers.append(timer)
    }

    /// 清除特定的高亮视图
    private func clearHighlight(_ view: NSView) {
        DispatchQueue.main.async { [weak self] in
            view.removeFromSuperview()
            if let index = self?.highlightViews.firstIndex(of: view) {
                self?.highlightViews.remove(at: index)
            }
        }
    }

    /// 清除所有高亮
    func clearAll() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            for view in self.highlightViews {
                view.removeFromSuperview()
            }
            self.highlightViews.removeAll()

            for timer in self.cleanupTimers {
                timer.invalidate()
            }
            self.cleanupTimers.removeAll()

            self.logger.log("Cleared all highlights")
        }
    }

    /// 确保覆盖窗口存在
    private func ensureOverlayWindow() {
        guard overlayWindow == nil else {
            return
        }

        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect.zero

        // 创建透明窗口
        let window = NSWindow(
            contentRect: screenFrame,
            styleMask: [.borderless, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        window.level = .floating
        window.backgroundColor = .clear
        window.isOpaque = false
        window.ignoresMouseEvents = true  // 不拦截鼠标事件
        window.hasShadow = false

        // 创建透明内容视图
        let contentView = NSView(frame: screenFrame)
        contentView.wantsLayer = true
        window.contentView = contentView

        // 显示窗口
        window.orderFrontRegardless()

        overlayWindow = window
        logger.log("Created overlay window")
    }

    deinit {
        clearAll()
        overlayWindow?.close()
    }
}
