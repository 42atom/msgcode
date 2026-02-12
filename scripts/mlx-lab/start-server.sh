#!/usr/bin/env bash
# msgcode: MLX LM Server 启动脚本
# 用途：启动 mlx_lm.server 后台服务用于 autonomous 工具闭环实验

set -euo pipefail

# ============================================
# 配置（可通过环境变量覆盖）
# ============================================

# ============================================
# 说明：mlx_lm.server 的 /v1/models 会列出：
# - HuggingFace cache 里“看起来像 MLX LM”的已下载模型（repo id）
# - 以及当前 --model 指定的本地模型路径（resolve 后的绝对路径）
#
# 所以当你看到 “MiniCPM + GLM 同时出现” 时，并不代表 server 同时加载了两个模型；
# 只是 /v1/models 列表包含了缓存中的 repo。
# 解决办法：让 probe 脚本用 MLX_MODEL_ID 精确指定要测的模型（默认取 MLX_MODEL_PATH 的 realpath）。
# ============================================

# 模型路径（必填）
MLX_MODEL_PATH="${MLX_MODEL_PATH:-}"

# 基础 URL（默认本地 18000 端口）
MLX_BASE_URL="${MLX_BASE_URL:-http://127.0.0.1:18000}"

# 最大 token 数
MLX_MAX_TOKENS="${MLX_MAX_TOKENS:-512}"

# 项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Venv 路径（优先使用项目内 venv，其次 ~/Models/venv）
VENV_DIR="${PROJECT_ROOT}/venv"
if [ ! -d "$VENV_DIR" ] || [ ! -f "$VENV_DIR/bin/mlx_lm.server" ]; then
    # 回退到 ~/Models/venv
    VENV_DIR="$HOME/Models/venv"
fi

# PID 文件路径
PID_FILE="/tmp/msgcode-mlx-lab.pid"

# 日志文件路径
LOG_FILE="/tmp/msgcode-mlx-lab.log"

# ============================================
# 参数校验
# ============================================

if [ -z "$MLX_MODEL_PATH" ]; then
    echo "错误: MLX_MODEL_PATH 环境变量未设置"
    echo "用法: MLX_MODEL_PATH=/path/to/model bash start-server.sh"
    exit 1
fi

if [ ! -d "$MLX_MODEL_PATH" ]; then
    echo "错误: 模型路径不存在: $MLX_MODEL_PATH"
    exit 1
fi

# 计算模型 ID（与 /v1/models 返回的本地模型 id 对齐）
MODEL_ID="$(python3 -c 'import os; from pathlib import Path; print(str(Path(os.environ["MLX_MODEL_PATH"]).resolve()))' 2>/dev/null || true)"
if [ -z "$MODEL_ID" ]; then
    MODEL_ID="$MLX_MODEL_PATH"
fi

# ============================================
# 从 MLX_BASE_URL 解析 host 和 port
# ============================================

# 解析 URL: protocol://host:port
# 例如: http://127.0.0.1:18000 -> host=127.0.0.1 port=18000
#
# 已知限制：
# - 不支持 IPv6 地址（如 http://[::1]:18000）
# - 必须显式指定端口（无端口 URL 会解析失败）
# - 如需支持以上场景，请改用更健壮的 URL 解析工具
URLWithoutProto="${MLX_BASE_URL#*://}"
URL_HOST="${URLWithoutProto%:*}"
URL_PORT="${URLWithoutProto#*:}"

# ============================================
# 启动服务
# ============================================

echo "启动 mlx_lm.server..."
echo "  模型路径: $MLX_MODEL_PATH"
echo "  模型 ID: $MODEL_ID"
echo "  监听地址: $URL_HOST:$URL_PORT"
echo "  最大 tokens: $MLX_MAX_TOKENS"
echo "  Python venv: $VENV_DIR"

# ============================================
# Venv 检查
# ============================================

if [ ! -f "$VENV_DIR/bin/mlx_lm.server" ]; then
    echo ""
    echo "错误: MLX LM Server 未在 venv 中找到"
    echo "  期望路径: $VENV_DIR/bin/mlx_lm.server"
    echo ""
    echo "解决方案："
    echo "  1. 运行 bootstrap 脚本安装 MLX："
    echo "     bash scripts/mlx-lab/bootstrap-venv.sh"
    echo ""
    echo "  2. 或使用外部 MLX（不推荐）："
    echo "     PATH=~/Models/venv/bin:\$PATH bash scripts/mlx-lab/start-server.sh"
    exit 1
fi

# ============================================
# 启动服务
# ============================================

# 使用 venv 中的 python 启动 mlx_lm.server
PYTHON_CMD="$VENV_DIR/bin/python"

nohup "$PYTHON_CMD" -m mlx_lm.server \
    --model "$MLX_MODEL_PATH" \
    --port "$URL_PORT" \
    --host "$URL_HOST" \
    --max-tokens "$MLX_MAX_TOKENS" \
    > "$LOG_FILE" 2>&1 &

# 记录 PID
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

# 等待服务启动
echo "等待服务启动..."
sleep 3

# 检查进程是否还在运行
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "错误: 服务启动失败，查看日志: $LOG_FILE"
    rm -f "$PID_FILE"
    exit 1
fi

# 等待 HTTP 就绪（避免 check-health 早于 server 监听导致“假失败”）
echo "等待 HTTP 就绪..."
READY=false
for i in $(seq 1 20); do
    if curl -s --max-time 2 "$MLX_BASE_URL/health" | jq -e '.status == "ok"' >/dev/null 2>&1; then
        READY=true
        break
    fi
    sleep 1
done
if [ "$READY" != "true" ]; then
    echo "错误: 服务未在预期时间内就绪（20s），查看日志: $LOG_FILE"
    exit 1
fi

# ============================================
# 输出提示
# ============================================

echo ""
echo "mlx_lm.server 启动成功!"
echo "  PID: $SERVER_PID"
echo "  PID 文件: $PID_FILE"
echo "  日志文件: $LOG_FILE"
echo ""
echo "建议：为避免 probe 脚本选错模型，先导出 MLX_MODEL_ID："
echo "  export MLX_MODEL_ID=\"$MODEL_ID\""
echo ""
echo "健康检查: curl ${MLX_BASE_URL}/v1/models"
echo "停止服务: bash scripts/mlx-lab/stop-server.sh"
echo ""
