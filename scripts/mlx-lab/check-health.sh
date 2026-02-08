#!/usr/bin/env bash
# msgcode: MLX LM Server 健康检查脚本
# 用途：检查服务是否正常运行

set -euo pipefail

# ============================================
# 配置
# ============================================

MLX_BASE_URL="${MLX_BASE_URL:-http://127.0.0.1:18000}"
CURL_TIMEOUT="${CURL_TIMEOUT:-30}"

# ============================================
# 健康检查
# ============================================

echo "检查服务健康状态: $MLX_BASE_URL/v1/models"

# 重试：避免 start-server 刚启动但端口尚未就绪导致“假失败”
RESPONSE=""
HTTP_CODE=""
for i in $(seq 1 20); do
    # 检查 HTTP 状态码
    HTTP_CODE=$(curl -s --max-time "$CURL_TIMEOUT" -o /dev/null -w "%{http_code}" "$MLX_BASE_URL/v1/models" || true)
    if [ "$HTTP_CODE" = "200" ]; then
        RESPONSE=$(curl -s --max-time "$CURL_TIMEOUT" "$MLX_BASE_URL/v1/models" || true)
        if [ -n "$RESPONSE" ]; then
            break
        fi
    fi
    sleep 1
done

if [ "$HTTP_CODE" != "200" ]; then
    echo "错误: HTTP 状态码 $HTTP_CODE (期望 200)"
    exit 1
fi

# 检查响应是否包含 data 字段
if ! echo "$RESPONSE" | jq -e '.data' > /dev/null 2>&1; then
    echo "错误: 响应格式无效"
    echo "响应: $RESPONSE"
    exit 1
fi

# 检查是否有模型
if ! echo "$RESPONSE" | jq -e '.data | length' > /dev/null 2>&1; then
    echo "错误: 响应中缺少 data 字段"
    echo "响应: $RESPONSE"
    exit 1
fi

MODEL_COUNT=$(echo "$RESPONSE" | jq -r '.data | length')
if [ "$MODEL_COUNT" -eq 0 ]; then
    echo "错误: 没有可用模型"
    echo "响应: $RESPONSE"
    exit 1
fi

# 输出模型信息
echo ""
echo "服务健康检查通过!"
echo "  HTTP 状态: 200"
echo "  可用模型数: $MODEL_COUNT"
echo ""
echo "模型列表:"
echo "$RESPONSE" | jq -r '.data[] | "  - \(.id)"'
echo ""

exit 0
