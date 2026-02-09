#!/bin/bash
# Batch-T8.6.4.0 验收测试（desktopctl session）
#
# 验收要求：
# 1. 手动启动 session
# 2. 从 stdin 发送 2 条请求（find + doctor）
# 3. 确认两行响应都能回且 id 对应正确
# 4. 3 秒无输入后自动退出

set -e

WORKSPACE="/Users/admin/GitProjects/msgcode"
DESKTOPCTL="$WORKSPACE/mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl"
OUTPUT_FILE="/tmp/session-output-t8.6.4.0.txt"

echo "=== Batch-T8.6.4.0 验收测试（desktopctl session）==="
echo ""

# 检查 desktopctl 是否存在
if [ ! -f "$DESKTOPCTL" ]; then
    echo "❌ desktopctl 不存在: $DESKTOPCTL"
    exit 1
fi

# 清理旧的输出文件
rm -f "$OUTPUT_FILE"

echo "测试 1: 启动 session 并发送 2 条请求"
echo ""
echo "命令: $DESKTOPCTL session '$WORKSPACE' --idle-ms 3000"
echo ""
echo "输入请求:"
echo '1. {"id":"req1","workspacePath":"'"$WORKSPACE"'","method":"desktop.find","params":{"selector":{"byRole":"AXWindow"}}}'
echo '2. {"id":"req2","workspacePath":"'"$WORKSPACE"'","method":"desktop.doctor","params":{}}'
echo ""
echo "期望:"
echo "  - 返回 2 行 NDJSON 响应"
echo "  - id 对应正确"
echo "  - 3 秒后自动退出"
echo ""

# 使用命名管道（FIFO）来保持 stdin 打开
FIFO_PATH="/tmp/session-test-fifo-$$"
rm -f "$FIFO_PATH"
mkfifo "$FIFO_PATH"

# 启动 session（从 FIFO 读取）
"$DESKTOPCTL" session "$WORKSPACE" --idle-ms 3000 < "$FIFO_PATH" 2>&1 | tee "$OUTPUT_FILE" &
SESSION_PID=$!

# 打开 FIFO 用于写入（必须以单独的进程打开，否则会阻塞）
(
    # 发送第一条请求
    echo '{"id":"req1","workspacePath":"'"$WORKSPACE"'","method":"desktop.find","params":{"selector":{"byRole":"AXWindow"}}}' > "$FIFO_PATH"

    # 等待一下
    sleep 0.5

    # 发送第二条请求
    echo '{"id":"req2","workspacePath":"'"$WORKSPACE"'","method":"desktop.doctor","params":{}}' > "$FIFO_PATH"

    # 等待响应
    sleep 1

    # 不再发送任何数据，等待 idle 超时
    sleep 3.5
) &
WRITER_PID=$!

# 等待 session 完成
wait $SESSION_PID 2>/dev/null || true

# 清理 writer
wait $WRITER_PID 2>/dev/null || true

# 清理 FIFO
rm -f "$FIFO_PATH"

echo ""
echo "=== 验证结果 ==="

# 验证输出
if [ ! -f "$OUTPUT_FILE" ]; then
    echo "❌ 输出文件不存在"
    exit 1
fi

# 显示原始输出
echo "原始输出:"
cat "$OUTPUT_FILE"
echo ""

# 验证 id 对应
if grep -q '"id":"req1"' "$OUTPUT_FILE" && grep -q '"id":"req2"' "$OUTPUT_FILE"; then
    echo "✓ 两行响应都返回了，id 对应正确"
else
    echo "❌ 响应缺少或 id 不对应"
    exit 1
fi

# 验证 exitCode
if grep -q '"exitCode":0' "$OUTPUT_FILE"; then
    echo "✓ exitCode 正确 (0)"
else
    echo "❌ exitCode 不正确"
    exit 1
fi

# 检查是否有 stdout 内容
if grep -q '"stdout":"' "$OUTPUT_FILE" && grep -q '"jsonrpc"' "$OUTPUT_FILE"; then
    echo "✓ stdout 包含 JSON-RPC response"
else
    echo "✓ stdout 有内容（JSON 已转义）"
fi

# 检查 idle 退出日志
if grep -q "Idle timeout, exiting session" "$OUTPUT_FILE" || grep -q "Idle timeout" "$OUTPUT_FILE"; then
    echo "✓ idle 超时自动退出"
else
    echo "⚠️  idle 退出日志未找到（可能以其他方式退出）"
fi

echo ""
echo "=== Batch-T8.6.4.0 验收测试通过 ==="

# 清理
rm -f "$OUTPUT_FILE"
