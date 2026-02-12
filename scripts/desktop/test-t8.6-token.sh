#!/bin/bash
# Batch-T8.6.1 验收测试辅助脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE="${WORKSPACE:-$(pwd)}"

echo "=== Batch-T8.6.1 验收测试 ==="
echo

# 检查 LaunchAgent 状态
echo "1. 检查 LaunchAgent 状态..."
LAUNCH_AGENT_PID=$(launchctl list | grep com.msgcode.desktop.bridge | awk '{print $1}')
if [ -z "$LAUNCH_AGENT_PID" ]; then
    echo "✗ LaunchAgent 未运行，请先启动："
    echo "   cd <msgcode-repo>/mac/MsgcodeDesktopHost"
    echo "   bash register_launchagent.sh install"
    exit 1
fi
echo "✓ LaunchAgent 运行中 (PID: $LAUNCH_AGENT_PID)"
echo

# 检查权限
echo "2. 检查权限..."
DOCTOR_OUTPUT=$("$WORKSPACE/mac/msgcode-desktopctl/.build/release/msgcode-desktopctl" doctor --workspace "$WORKSPACE" 2>&1)
PERMISSIONS=$(echo "$DOCTOR_OUTPUT" | jq -r '.result.permissions')

if echo "$PERMISSIONS" | jq -e '.accessibility.granted == false or .screenRecording.granted == false'; then
    echo "⚠ 权限缺失，请手动授予："
    echo "   系统设置 → 隐私与安全性 → 辅助功能"
    echo "   系统设置 → 隐私与安全性 → 屏幕录制"
    echo
    read -p "授予权限后按 Enter 继续..."
fi

echo

# 编译 Swift 测试脚本
echo "3. 编译测试脚本..."
cd "$SCRIPT_DIR"
swiftc -o test-t8.6-token test-t8.6-token.swift \
    -framework Foundation \
    -framework OSLog \
    -o test-t8.6-token \
    2>&1 || {
    echo "✗ 编译失败"
    exit 1
}
echo "✓ 编译成功"
echo

# 运行测试
echo "4. 运行端到端测试..."
./test-t8.6.token
EXIT_CODE=$?

echo
if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ Batch-T8.6.1 验收测试全部通过！"
else
    echo "❌ Batch-T8.6.1 验收测试失败 (exit code: $EXIT_CODE)"
fi

exit $EXIT_CODE
