#!/bin/bash
# msgcode Desktop Bridge LaunchAgent 注册脚本
# 用于注册 com.msgcode.desktop.bridge Mach service

set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 获取脚本所在目录的绝对路径
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR" && pwd)"
HOST_APP="$PROJECT_ROOT/MsgcodeDesktopHost.app"
HOST_EXEC="$HOST_APP/Contents/MacOS/MsgcodeDesktopHost"

# LaunchAgent plist 文件路径
LAUNCH_AGENT_PLIST="$HOME/Library/LaunchAgents/com.msgcode.desktop.bridge.plist"

echo "========================================"
echo "msgcode Desktop Bridge LaunchAgent 管理"
echo "========================================"
echo "项目目录: $PROJECT_ROOT"
echo "Host App: $HOST_APP"
echo ""

# 检查 Host App 是否存在
if [ ! -d "$HOST_APP" ]; then
    echo -e "${RED}✗ MsgcodeDesktopHost.app 不存在${NC}"
    echo "请先运行: bash build.sh"
    exit 1
fi
echo -e "${GREEN}✓ MsgcodeDesktopHost.app 存在${NC}"
echo ""

# 解析 install 子命令的参数
ENABLE_TEST_MODE=""
if [ "${1:-}" == "install" ] && [ "${2:-}" == "--test" ]; then
  ENABLE_TEST_MODE="yes"
  shift  # 移除 --test 参数
fi

case "${1:-}" in
  install)
    echo "========================================"
    echo "安装 LaunchAgent"
    echo "========================================"
    echo ""

    if [ -n "$ENABLE_TEST_MODE" ]; then
      echo -e "${YELLOW}⚠ 测试模式已启用：OPENCLAW_DESKTOP_TEST_HOOKS=1${NC}"
      echo ""
    fi

    # 生成 LaunchAgent plist 文件
    echo "生成 plist 文件: $LAUNCH_AGENT_PLIST"
    cat > "$LAUNCH_AGENT_PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.msgcode.desktop.bridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>$HOST_EXEC</string>
        <string>--launchd</string>
    </array>
    <key>MachServices</key>
    <dict>
        <key>com.msgcode.desktop.bridge</key>
        <dict>
            <key>ExportedObjectInterface</key>
            <string>com.msgcode.desktop.bridge.BridgeXPCProtocol</string>
        </dict>
    </dict>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
EOF

    # T16.0.6: 测试模式下注入环境变量
    if [ -n "$ENABLE_TEST_MODE" ]; then
      cat >> "$LAUNCH_AGENT_PLIST" << EOF
    <key>EnvironmentVariables</key>
    <dict>
        <key>OPENCLAW_DESKTOP_TEST_HOOKS</key>
        <string>1</string>
    </dict>
EOF
    fi

    cat >> "$LAUNCH_AGENT_PLIST" << EOF
</dict>
</plist>
EOF

    # 加载 LaunchAgent
    echo "加载 LaunchAgent..."
    launchctl load "$LAUNCH_AGENT_PLIST" 2>/dev/null || echo "  (可能已加载)"
    
    # 启动服务
    echo "启动服务..."
    launchctl start com.msgcode.desktop.bridge 2>/dev/null || echo "  (可能已运行)"
    
    echo ""
    echo -e "${GREEN}✓ LaunchAgent 安装完成${NC}"
    echo ""
    echo "验证服务状态:"
    launchctl list | grep com.msgcode.desktop.bridge || echo "  (服务未在列表中，可能需要重启)"
    ;;
    
  uninstall)
    echo "========================================"
    echo "卸载 LaunchAgent"
    echo "========================================"
    echo ""
    
    # 停止服务
    echo "停止服务..."
    launchctl stop com.msgcode.desktop.bridge 2>/dev/null || echo "  (服务未运行)"
    
    # 卸载 LaunchAgent
    echo "卸载 LaunchAgent..."
    launchctl unload "$LAUNCH_AGENT_PLIST" 2>/dev/null || echo "  (未加载)"
    
    # 删除 plist 文件
    if [ -f "$LAUNCH_AGENT_PLIST" ]; then
        rm "$LAUNCH_AGENT_PLIST"
        echo "已删除 plist 文件"
    fi
    
    echo ""
    echo -e "${GREEN}✓ LaunchAgent 卸载完成${NC}"
    ;;
    
  status)
    echo "========================================"
    echo "LaunchAgent 状态"
    echo "========================================"
    echo ""
    
    if [ -f "$LAUNCH_AGENT_PLIST" ]; then
        echo "plist 文件: $LAUNCH_AGENT_PLIST"
        echo "✓ 已安装"
    else
        echo "plist 文件: 不存在"
        echo "✗ 未安装"
    fi
    
    echo ""
    echo "服务状态:"
    if launchctl list | grep -q "com.msgcode.desktop.bridge"; then
        echo "✓ 服务已加载"
        launchctl list | grep com.msgcode.desktop.bridge
    else
        echo "✗ 服务未加载"
    fi
    ;;
    
  *)
    echo "用法:"
    echo "  $0 install [--test]  - 安装并启动 LaunchAgent"
    echo "                          --test: 启用测试钩子 (OPENCLAW_DESKTOP_TEST_HOOKS=1)"
    echo "  $0 uninstall         - 卸载 LaunchAgent"
    echo "  $0 status            - 查看 LaunchAgent 状态"
    echo ""
    echo "示例:"
    echo "  $0 install           # 生产模式安装"
    echo "  $0 install --test    # 测试模式安装（启用测试钩子）"
    exit 1
    ;;
esac
