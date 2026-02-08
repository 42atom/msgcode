#!/usr/bin/env bash
# msgcode: 基础响应测试
# 用途：验证模型能正确响应简单指令

set -euo pipefail

# ============================================
# 配置
# ============================================

MLX_BASE_URL="${MLX_BASE_URL:-http://127.0.0.1:18000}"
MLX_MODEL_ID="${MLX_MODEL_ID:-}"
MLX_MODEL_PATH="${MLX_MODEL_PATH:-}"
CURL_TIMEOUT="${CURL_TIMEOUT:-30}"
TEMPERATURE="${TEMPERATURE:-1.0}"  # Unsloth 通用对话推荐
TOP_P="${TOP_P:-0.95}"           # Unsloth 通用对话推荐
MAX_TOKENS="${MAX_TOKENS:-256}"
ROUNDS=5

# 优先使用本地模型路径的 realpath 作为 model id（避免 /v1/models 里选到 HF cache 的其他模型）
if [ -z "$MLX_MODEL_ID" ] && [ -n "$MLX_MODEL_PATH" ] && [ -d "$MLX_MODEL_PATH" ]; then
    MLX_MODEL_ID="$(python3 -c 'import os; from pathlib import Path; print(str(Path(os.environ["MLX_MODEL_PATH"]).resolve()))' 2>/dev/null || true)"
fi

# 自动探测模型 ID（如果未设置）
if [ -z "$MLX_MODEL_ID" ]; then
    echo "探测模型 ID..."
    DETECT_RESPONSE=$(curl -s --max-time "$CURL_TIMEOUT" "$MLX_BASE_URL/v1/models")
    # 优先选择包含 GLM 的模型，其次是第一个模型
    MLX_MODEL_ID=$(echo "$DETECT_RESPONSE" | jq -r '.data[] | select(.id | contains("GLM") or contains("glm")) | .id' | head -1)
    if [ -z "$MLX_MODEL_ID" ]; then
        # 回退到第一个模型
        MLX_MODEL_ID=$(echo "$DETECT_RESPONSE" | jq -r '.data[0].id // empty')
    fi
    if [ -z "$MLX_MODEL_ID" ]; then
        echo "错误: 无法自动探测模型 ID"
        echo "响应: $DETECT_RESPONSE"
        exit 1
    fi
    echo "探测到模型: $MLX_MODEL_ID"
fi

# ============================================
# 基础测试
# ============================================

echo "基础响应测试 ($ROUNDS 轮)"
echo "测试指令: 只输出 OK"
echo "参数: temperature=$TEMPERATURE top_p=$TOP_P max_tokens=$MAX_TOKENS"
echo ""

PASS_COUNT=0

for i in $(seq 1 $ROUNDS); do
    echo -n "[$i/$ROUNDS] "

    RESPONSE=$(curl -s --max-time "$CURL_TIMEOUT" "$MLX_BASE_URL/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -d "{
            \"model\": \"$MLX_MODEL_ID\",
            \"messages\": [
                {\"role\": \"system\", \"content\": \"你是严格的输出器。不要输出思考过程，不要输出 reasoning。只允许输出 OK 两个字符（大写），不允许任何其它字符、空格或换行。\"},
                {\"role\": \"user\", \"content\": \"只输出 OK，不要其他内容\"}
            ],
            \"temperature\": $TEMPERATURE,
            \"top_p\": $TOP_P,
            \"max_tokens\": $MAX_TOKENS
        }" || true)

    if [ -z "$RESPONSE" ]; then
        echo "失败: 空响应（curl 失败或超时）"
        continue
    fi

    # 检查响应是否包含必需字段
    if ! echo "$RESPONSE" | jq -e '.choices[0].message.content' > /dev/null 2>&1; then
        echo "失败: 响应格式无效"
        echo "响应: $RESPONSE"
        exit 1
    fi

    # 提取响应内容并裁剪空白
    CONTENT=$(echo "$RESPONSE" | jq -r '.choices[0].message.content')
    CONTENT_TRIM=$(echo "$CONTENT" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

    # 检查是否严格等于 OK
    if [ "$CONTENT_TRIM" = "OK" ]; then
        echo "通过: $CONTENT_TRIM"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        FINISH=$(echo "$RESPONSE" | jq -r '.choices[0].finish_reason // ""' 2>/dev/null || true)
        echo "失败: '$CONTENT_TRIM' (finish_reason=$FINISH)"
    fi
done

echo ""
echo "结果: basic_pass = $PASS_COUNT/$ROUNDS"

if [ "$PASS_COUNT" -eq "$ROUNDS" ]; then
    echo "状态: 通过"
    exit 0
else
    echo "状态: 失败"
    exit 1
fi
