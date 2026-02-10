#!/bin/bash
# 回归测试：token issue → use → reuse
# 验证：reuse 同 token 返回 DESKTOP_CONFIRM_REQUIRED
#
# 用法：bash scripts/desktop/test-token-reuse.sh
# 退出码：0 全部通过，1 失败

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DESKTOPCTL="$PROJECT_ROOT/mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl"
WORKSPACE="$PROJECT_ROOT"

echo "=== Token Reuse 回归测试 ==="
echo

# 前置检查
if [ ! -x "$DESKTOPCTL" ]; then
    echo "✗ desktopctl 未编译: $DESKTOPCTL"
    echo "  请先: cd $PROJECT_ROOT/mac/msgcode-desktopctl && swift build"
    exit 1
fi

FAILURES=0

# 辅助函数：调用 RPC
call_rpc() {
    local method="$1"
    local params="$2"
    "$DESKTOPCTL" rpc "$WORKSPACE" --method "$method" --params-json "$params" 2>/dev/null || true
}

# 辅助函数：提取 JSON 字段
extract_field() {
    echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d$2)" 2>/dev/null || echo ""
}

echo "1. Issue token (desktop.typeText intent)..."
ISSUE_RESP=$(call_rpc "desktop.confirm.issue" '{
  "intent": {
    "method": "desktop.typeText",
    "params": {
      "target": {"selector": {"byRole": "AXTextArea"}},
      "text": "test_reuse"
    }
  },
  "ttlMs": 60000
}')

TOKEN=$(extract_field "$ISSUE_RESP" "['result']['token']")
if [ -z "$TOKEN" ]; then
    echo "✗ Token 签发失败"
    echo "  Response: $ISSUE_RESP"
    exit 1
fi
echo "✓ Token 签发成功: ${TOKEN:0:8}..."
echo

echo "2. Use token (desktop.typeText)..."
USE_RESP=$(call_rpc "desktop.typeText" "{
  \"target\": {\"selector\": {\"byRole\": \"AXTextArea\"}},
  \"text\": \"test_reuse\",
  \"confirm\": {\"token\": \"$TOKEN\"}
}")

# 检查是否成功（或权限缺失——权限缺失不消费 token）
USE_ERROR=$(extract_field "$USE_RESP" "['error']['code']")
if [ "$USE_ERROR" = "DESKTOP_PERMISSION_MISSING" ]; then
    echo "⚠ 权限缺失（token 未消费），跳过 reuse 测试"
    echo "  需先授予辅助功能权限"
    exit 0
fi

USE_RESULT=$(extract_field "$USE_RESP" "['result']['text']")
if [ "$USE_RESULT" = "test_reuse" ]; then
    echo "✓ Token 使用成功"
elif [ -n "$USE_ERROR" ]; then
    echo "✗ Token 使用失败: $USE_ERROR"
    echo "  Response: $USE_RESP"
    FAILURES=$((FAILURES + 1))
fi
echo

echo "3. Reuse same token (expect DESKTOP_CONFIRM_REQUIRED)..."
REUSE_RESP=$(call_rpc "desktop.typeText" "{
  \"target\": {\"selector\": {\"byRole\": \"AXTextArea\"}},
  \"text\": \"test_reuse\",
  \"confirm\": {\"token\": \"$TOKEN\"}
}")

REUSE_CODE=$(extract_field "$REUSE_RESP" "['error']['code']")
REUSE_REASON=$(extract_field "$REUSE_RESP" "['error']['details']['reason']")
if [ "$REUSE_CODE" = "DESKTOP_CONFIRM_REQUIRED" ]; then
    echo "✓ Reuse 正确返回 DESKTOP_CONFIRM_REQUIRED"
    if [ "$REUSE_REASON" = "used" ]; then
        echo "✓ details.reason = used"
    else
        echo "⚠ details.reason 期望 'used', 实际 '$REUSE_REASON'"
    fi
else
    echo "✗ Reuse 返回错误码不符"
    echo "  期望: DESKTOP_CONFIRM_REQUIRED"
    echo "  实际: $REUSE_CODE"
    echo "  Response: $REUSE_RESP"
    FAILURES=$((FAILURES + 1))
fi
echo

if [ $FAILURES -eq 0 ]; then
    echo "=== ✅ Token Reuse 回归测试全部通过 ==="
    exit 0
else
    echo "=== ❌ Token Reuse 回归测试失败 ($FAILURES 项) ==="
    exit 1
fi
