#!/usr/bin/env bash
# msgcode: MLX LM Server 停止脚本
# 用途：停止 mlx_lm.server 后台服务

set -euo pipefail

# ============================================
# 配置
# ============================================

PID_FILE="/tmp/msgcode-mlx-lab.pid"

# ============================================
# 停止服务
# ============================================

if [ ! -f "$PID_FILE" ]; then
    echo "提示: PID 文件不存在，服务可能未运行"
    exit 0
fi

# 读取 PID
SERVER_PID=$(cat "$PID_FILE")

# 检查进程是否还在运行
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "提示: 进程 $SERVER_PID 不存在，清理 PID 文件"
    rm -f "$PID_FILE"
    exit 0
fi

# 停止进程
echo "停止 mlx_lm.server (PID: $SERVER_PID)..."
kill "$SERVER_PID"

# 等待进程结束
for i in {1..10}; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
        echo "服务已停止"
        break
    fi
    sleep 1
done

# 如果进程仍在运行，强制终止
if kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "警告: 进程未响应，强制终止..."
    kill -9 "$SERVER_PID" 2>/dev/null || true
fi

# 清理 PID 文件
rm -f "$PID_FILE"

echo "完成"
