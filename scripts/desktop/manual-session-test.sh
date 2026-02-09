#!/bin/bash
# 手动测试 session 进程

WORKSPACE="/Users/admin/GitProjects/msgcode"
DESKTOPCTL="$WORKSPACE/mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl"
FIFO_PATH="/tmp/session-test-fifo-$$"

rm -f "$FIFO_PATH"
mkfifo "$FIFO_PATH"

# 启动 session（后台）
"$DESKTOPCTL" session "$WORKSPACE" --idle-ms 5000 < "$FIFO_PATH" &
SESSION_PID=$!

sleep 1

# 发送请求
echo '{"id":"test-1","workspacePath":"'"$WORKSPACE"'","method":"desktop.health","params":{}}' > "$FIFO_PATH"

# 等待响应
sleep 2

# 清理
kill $SESSION_PID 2>/dev/null || true
rm -f "$FIFO_PATH"
