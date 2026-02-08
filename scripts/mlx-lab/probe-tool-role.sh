#!/usr/bin/env bash
# msgcode: Tool Role 回灌测试
# 用途：验证模型能正确处理 role=tool 的消息

set -euo pipefail

# ============================================
# 配置
# ============================================

MLX_BASE_URL="${MLX_BASE_URL:-http://127.0.0.1:18000}"
MLX_MODEL_ID="${MLX_MODEL_ID:-}"
MLX_MODEL_PATH="${MLX_MODEL_PATH:-}"
CURL_TIMEOUT="${CURL_TIMEOUT:-30}"
TEMPERATURE="${TEMPERATURE:-0.7}"
TOP_P="${TOP_P:-1}"
MAX_TOKENS="${MAX_TOKENS:-2048}"
ROUNDS=10

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
# Tool Role 测试
# ============================================

echo "Tool Role 回灌测试 ($ROUNDS 轮)"
echo "测试: 模型应该只输出工具返回的值 (42)"
echo "参数: temperature=$TEMPERATURE top_p=$TOP_P max_tokens=$MAX_TOKENS"
echo ""

PASS_COUNT=0
FAIL_SAMPLES=()

for i in $(seq 1 $ROUNDS); do
    echo -n "[$i/$ROUNDS] "

    # OpenAI tool protocol: role=tool 必须与前一条 assistant.tool_calls 的 id 对应。
    # 这里构造一个最小合法链路：assistant(tool_calls) → tool(tool_call_id) → user
    TOOL_CALL_ID="call_42"
    TOOL_CALLS=$(jq -cn --arg tcid "$TOOL_CALL_ID" '[
      {
        id: $tcid,
        type: "function",
        function: { name: "read_value", arguments: "{}" }
      }
    ]')

    RESPONSE=$(curl -s --max-time "$CURL_TIMEOUT" "$MLX_BASE_URL/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -d "{
            \"model\": \"$MLX_MODEL_ID\",
            \"messages\": [
                {\"role\": \"system\", \"content\": \"你只能回答 TOOL= 后面的值。只输出数字，不要解释，不要输出思考过程。\"},
                {\"role\": \"assistant\", \"content\": \"\", \"tool_calls\": $TOOL_CALLS},
                {\"role\": \"tool\", \"tool_call_id\": \"$TOOL_CALL_ID\", \"content\": \"TOOL=42\"},
                {\"role\": \"user\", \"content\": \"值是多少？只输出数字\"}
            ],
            \"temperature\": $TEMPERATURE,
            \"top_p\": $TOP_P,
            \"max_tokens\": $MAX_TOKENS
        }" || true)

    if [ -z "$RESPONSE" ]; then
        echo "失败: 空响应（curl 失败或超时）"
        if [ ${#FAIL_SAMPLES[@]} -lt 3 ]; then
            FAIL_SAMPLES+=("[$i] 空响应（curl 失败或超时）")
        fi
        continue
    fi

    # 检查响应是否包含必需字段
    if ! echo "$RESPONSE" | jq -e '.choices[0].message.content' > /dev/null 2>&1; then
        echo "失败: 响应格式无效"
        if [ ${#FAIL_SAMPLES[@]} -lt 3 ]; then
            FAIL_SAMPLES+=("[$i] 响应格式无效: $RESPONSE")
        fi
        continue
    fi

    # 提取响应内容
    CONTENT=$(echo "$RESPONSE" | jq -r '.choices[0].message.content')

    # 允许模型带少量解释，提取首个数字作为判定
    FIRST_NUMBER=$(echo "$CONTENT" | grep -oE '[0-9]+' | head -1 || true)

    if [ "$FIRST_NUMBER" = "42" ]; then
        echo "通过: $CONTENT"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        FINISH=$(echo "$RESPONSE" | jq -r '.choices[0].finish_reason // ""' 2>/dev/null || true)
        echo "失败: '$CONTENT' (finish_reason=$FINISH)"
        if [ ${#FAIL_SAMPLES[@]} -lt 3 ]; then
            FAIL_SAMPLES+=("[$i] '$CONTENT'")
        fi
    fi
done

echo ""
echo "结果: tool_role_pass = $PASS_COUNT/$ROUNDS"

if [ ${#FAIL_SAMPLES[@]} -gt 0 ]; then
    echo ""
    echo "失败样本:"
    for sample in "${FAIL_SAMPLES[@]}"; do
        echo "  $sample"
    done
fi

if [ "$PASS_COUNT" -ge 9 ]; then
    echo "状态: 通过"
    exit 0
else
    echo "状态: 失败"
    exit 1
fi
