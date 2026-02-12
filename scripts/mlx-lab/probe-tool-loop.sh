#!/usr/bin/env bash
# msgcode: 工具闭环测试
# 用途：验证两轮工具调用闭环（模拟 autonomous 工具编排）

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
MAX_TOKENS="${MAX_TOKENS:-512}"
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
# 工具闭环测试
# ============================================

echo "工具闭环测试 ($ROUNDS 轮)"
echo "测试: 模拟两轮工具调用闭环"
echo "参数: temperature=$TEMPERATURE top_p=$TOP_P max_tokens=$MAX_TOKENS"
echo ""

PASS_COUNT=0
FAIL_SAMPLES=()

for i in $(seq 1 $ROUNDS); do
    echo -n "[$i/$ROUNDS] "

    # 第 1 轮：请求工具调用（通过 tool_calls 判定是否成功）
    RESPONSE1=$(curl -s --max-time "$CURL_TIMEOUT" "$MLX_BASE_URL/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -d "{
            \"model\": \"$MLX_MODEL_ID\",
            \"messages\": [
                {\"role\": \"system\", \"content\": \"你是工具助手。必须先调用工具再回答。\"},
                {\"role\": \"user\", \"content\": \"请读取答案并只输出数字\"}
            ],
            \"tools\": [
                {
                    \"type\": \"function\",
                    \"function\": {
                        \"name\": \"read_value\",
                        \"description\": \"读取固定值\",
                        \"parameters\": {
                            \"type\": \"object\",
                            \"properties\": {},
                            \"required\": []
                        }
                    }
                }
            ],
            \"tool_choice\": \"auto\",
            \"temperature\": $TEMPERATURE,
            \"top_p\": $TOP_P,
            \"max_tokens\": $MAX_TOKENS
        }" || true)

    if [ -z "$RESPONSE1" ]; then
        echo "失败: 第1轮空响应（curl 失败或超时）"
        if [ ${#FAIL_SAMPLES[@]} -lt 3 ]; then
            FAIL_SAMPLES+=("[$i] 第1轮空响应（curl 失败或超时）")
        fi
        continue
    fi

    # 第一轮必须产生 tool_calls
    if ! echo "$RESPONSE1" | jq -e '.choices[0].finish_reason == "tool_calls" and (.choices[0].message.tool_calls | length > 0)' > /dev/null 2>&1; then
        echo "失败: 第1轮响应格式无效"
        if [ ${#FAIL_SAMPLES[@]} -lt 3 ]; then
            FAIL_SAMPLES+=("[$i] 第1轮响应无效: $RESPONSE1")
        fi
        continue
    fi

    CONTENT1=$(echo "$RESPONSE1" | jq -r '.choices[0].message.content')
    TOOL_CALLS=$(echo "$RESPONSE1" | jq -c '.choices[0].message.tool_calls')
    TOOL_CALL_ID=$(echo "$RESPONSE1" | jq -r '.choices[0].message.tool_calls[0].id')

    # 模拟工具执行（固定返回 42）
    TOOL_RESULT='{"value": 42}'

    # 构造第二轮 payload（回灌 assistant+tool）
    PAYLOAD2=$(jq -cn \
      --arg model "$MLX_MODEL_ID" \
      --arg ac "$CONTENT1" \
      --arg tcid "$TOOL_CALL_ID" \
      --argjson tcs "$TOOL_CALLS" \
      --arg tresult "$TOOL_RESULT" \
      --arg temp "$TEMPERATURE" \
      --arg top_p "$TOP_P" \
      --arg max_tokens "$MAX_TOKENS" \
      '{
        model: $model,
        messages: [
          {role: "system", content: "你是工具助手。只输出最终数字。"},
          {role: "user", content: "请读取答案并只输出数字"},
          {role: "assistant", content: $ac, tool_calls: $tcs},
          {role: "tool", tool_call_id: $tcid, content: $tresult}
        ],
        temperature: ($temp|tonumber),
        top_p: ($top_p|tonumber),
        max_tokens: ($max_tokens|tonumber)
      }')

    # 第 2 轮：回灌工具结果
    RESPONSE2=$(curl -s --max-time "$CURL_TIMEOUT" "$MLX_BASE_URL/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -d "$PAYLOAD2" || true)

    if [ -z "$RESPONSE2" ]; then
        echo "失败: 第2轮空响应（curl 失败或超时）"
        if [ ${#FAIL_SAMPLES[@]} -lt 3 ]; then
            FAIL_SAMPLES+=("[$i] 第2轮空响应（curl 失败或超时）")
        fi
        continue
    fi

    # 检查响应是否包含必需字段
    if ! echo "$RESPONSE2" | jq -e '.choices[0].message.content' > /dev/null 2>&1; then
        echo "失败: 第2轮响应格式无效"
        if [ ${#FAIL_SAMPLES[@]} -lt 3 ]; then
            FAIL_SAMPLES+=("[$i] 第2轮响应无效: $RESPONSE2")
        fi
        continue
    fi

    CONTENT2=$(echo "$RESPONSE2" | jq -r '.choices[0].message.content')
    FIRST_NUMBER=$(echo "$CONTENT2" | grep -oE '[0-9]+' | head -1 || true)

    # 检查是否输出 42
    if [ "$FIRST_NUMBER" = "42" ]; then
        echo "通过: $CONTENT2"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo "失败: '$CONTENT2'"
        if [ ${#FAIL_SAMPLES[@]} -lt 3 ]; then
            FAIL_SAMPLES+=("[$i] 第1轮: '$CONTENT1' | 第2轮: '$CONTENT2'")
        fi
    fi
done

echo ""
echo "结果: tool_loop_pass = $PASS_COUNT/$ROUNDS"

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
