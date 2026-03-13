#!/bin/bash
# MsgcodeDesktopHost 构建
# Track A: 只构建 Host App（内置 Bridge Server，不再构建独立的 XPC Service）

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/.build"
APP_NAME="MsgcodeDesktopHost"
APP_BUNDLE="$APP_NAME.app"
CONTENTS="$APP_BUNDLE/Contents"
MACOS="$CONTENTS/MacOS"

mkdir -p "$BUILD_DIR"

echo "Build: $APP_NAME (Host App with built-in Bridge Server)"

pushd "$SCRIPT_DIR" >/dev/null

SDK_PATH="$(xcrun --sdk macosx --show-sdk-path)"
ARCH="$(uname -m)"

# 1. 构建 Host App（包含 BridgeServer.swift + HighlightOverlay）
echo "Build: swiftc"
swiftc -o "$BUILD_DIR/$APP_NAME" \
    -target "${ARCH}-apple-macosx14.0" \
    -sdk "$SDK_PATH" \
    -F "$SDK_PATH/System/Library/Frameworks" \
    -I "$BUILD_DIR" \
    BridgeXPC/BridgeXPCProtocol.swift BridgeServer.swift HostApp/ConfigLoader.swift HostApp/HighlightOverlay.swift HostApp/main.swift

# 2. 创建 app bundle 结构
echo "Build: app bundle"
rm -rf "$APP_BUNDLE"
mkdir -p "$MACOS"

# 3. 复制 Host App 可执行文件
echo "Build: copy executable"
cp "$BUILD_DIR/$APP_NAME" "$MACOS/"

# 4. 创建 Host App Info.plist
echo "Build: Info.plist"
cat > "$CONTENTS/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>MsgcodeDesktopHost</string>
    <key>CFBundleIconFile</key>
    <string></string>
    <key>CFBundleIdentifier</key>
    <string>com.msgcode.desktop.host</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>MsgcodeDesktopHost</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>14.0</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
    <key>NSSupportsAutomaticTermination</key>
    <false/>
    <key>NSAppleScriptEnabled</key>
    <false/>
</dict>
</plist>
EOF

# 5. 创建 PkgInfo
echo "Build: PkgInfo"
echo "APPL????" > "$CONTENTS/PkgInfo"

popd >/dev/null

echo "OK"
echo "App bundle: $SCRIPT_DIR/$APP_BUNDLE"
echo ""
echo "Notes:"
echo "   - Bridge Server (NSXPCListener) 现在运行在 HostApp 进程内"
echo "   - 不再生成独立的 MsgcodeDesktopBridge.xpc"
echo "   - TCC 权限检查现在指向 HostApp 进程（com.msgcode.desktop.host）"
echo ""
echo "First run requires permissions:"
echo "   - 系统设置 → 隐私与安全性 → 辅助功能"
echo "   - 系统设置 → 隐私与安全性 → 屏幕录制"
echo ""
echo "Run: open $SCRIPT_DIR/$APP_BUNDLE"
echo ""
echo "LaunchAgent: bash $SCRIPT_DIR/register_launchagent.sh install"
echo "Test: mac/msgcode-desktopctl/.build/release/msgcode-desktopctl ping"
