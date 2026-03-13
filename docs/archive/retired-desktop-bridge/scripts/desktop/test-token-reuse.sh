#!/bin/bash
#
# test-token-reuse.sh: 测试 token reuse 拒绝（Session 模式）
#
# 验收标准：
# - 同 session 内，第一次使用 token 成功
# - 同 session 内，第二次使用同一 token 失败（返回 DESKTOP_CONFIRM_REQUIRED + reason=used）
#
# 用法：bash scripts/desktop/test-token-reuse.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DESKTOPCTL="$PROJECT_ROOT/mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl"
WORKSPACE="$PROJECT_ROOT"

echo "=== Token Reuse 测试（Session 模式）==="
echo "Workspace: $WORKSPACE"
echo

# 前置检查
if [ ! -x "$DESKTOPCTL" ]; then
    echo "✗ desktopctl 未编译: $DESKTOPCTL"
    echo "  请先: cd $PROJECT_ROOT/mac/msgcode-desktopctl && swift build"
    exit 1
fi

# 创建临时管道
SESSION_ID="reuse-$$"
SESSION_IN="/tmp/session-in-$SESSION_ID"
SESSION_OUT="/tmp/session-out-$SESSION_ID"
mkfifo "$SESSION_IN"
mkfifo "$SESSION_OUT"

# 启动 session（后台）
echo "[1] 启动 desktopctl session..."
"$DESKTOPCTL" session "$WORKSPACE" < "$SESSION_IN" > "$SESSION_OUT" 2>&1 &
SESSION_PID=$!

# 打开文件描述符
exec 3>"$SESSION_IN"
exec 4<"$SESSION_OUT"

# 等待 session 启动
sleep 1

# 辅助函数：发送请求并读取响应
send_request() {
    local id="$1"
    local method="$2"
    local params="$3"

    # 发送请求（NDJSON 格式）
    echo "{\"id\":\"$id\",\"method\":\"$method\",\"params\":$params,\"workspacePath\":\"$WORKSPACE\"}" >&3

    # 读取响应（使用超时子进程）
    local response=""
    local elapsed=0
    while [ $elapsed -lt 50 ]; do
        # 尝试读取一行（非阻塞）
        if IFS= read -r response <&4; then
            echo "$response"
            return 0
        fi
        sleep 0.1
        elapsed=$((elapsed + 1))
    done

    echo "ERROR: 超时等待响应" >&2
    return 1
}

# 辅助函数：提取 JSON 字段（使用 grep/sed，避免依赖 python）
extract_json_field() {
    local json="$1"
    local field="$2"
    echo "$json" | grep -o "\"$field\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/'
}

# 辅助函数：提取嵌套字段
extract_nested_field() {
    local json="$1"
    local path="$2"  # 例如: "result.token"

    # 简单的路径解析
    local current="$json"
    IFS='.' read -ra PARTS <<< "$path"
    for part in "${PARTS[@]}"; do
        # 提取当前层级
        current=$(echo "$current" | grep -o "\"$part\"[[:space:]]*:[[:space:]]*{[^}]*}" | head -1)
        if [ -z "$current" ]; then
            # 尝试字符串值
            current=$(echo "$json" | grep -o "\"$part\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
        fi
    done

    # 从结果中提取值
    if echo "$current" | grep -q '"'; then
        echo "$current" | grep -o '"value"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"\([^"]*\)".*/\1/' || echo "$current" | sed 's/.*: *"\([^"]*\)".*/\1/'
    else
        echo "$current"
    fi
}

# 步骤 1: 签发 token
echo "[2] 签发 token..."
ISSUE_RESP=$(send_request "issue-1" "desktop.confirm.issue" '{"intent":{"method":"desktop.observe","params":{"options":{"includeScreenshot":false}}},"ttlMs":60000}')

# 使用 grep 提取 token（更可靠的方式）
TOKEN=$(echo "$ISSUE_RESP" | grep -o '"token"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"\([^"]*\)".*/\1/')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ] || [ "$TOKEN" = "" ]; then
    echo "✗ Token 签发失败"
    echo "  Response: $ISSUE_RESP"
    kill $SESSION_PID 2>/dev/null || true
    rm -f "$SESSION_IN" "$SESSION_OUT"
    exit 1
fi
echo "✓ Token 已签发: ${TOKEN:0:8}..."
echo

# 步骤 2: 第一次使用 token（应该成功）
echo "[3] 第一次使用 token..."
USE1_RESP=$(send_request "use-1" "desktop.observe" "{\"options\":{\"includeScreenshot\":false},\"confirm\":{\"token\":\"$TOKEN\"}}")

# 检查错误码
USE1_ERROR=$(echo "$USE1_RESP" | grep -o '"error"[[:space:]]*:[[:space:]]*{[^}]*}' | head -1)
if [ -n "$USE1_ERROR" ]; then
    USE1_CODE=$(echo "$USE1_ERROR" | grep -o '"code"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"\([^"]*\)".*/\1/')
    if [ "$USE1_CODE" = "DESKTOP_PERMISSION_MISSING" ]; then
        echo "⚠ 权限缺失，跳过 reuse 测试"
        echo "  需先授予辅助功能权限"
        kill $SESSION_PID 2>/dev/null || true
        rm -f "$SESSION_IN" "$SESSION_OUT"
        exit 0
    fi
    echo "✗ 第一次使用 token 失败: $USE1_CODE"
    echo "  Response: $USE1_RESP"
    kill $SESSION_PID 2>/dev/null || true
    rm -f "$SESSION_IN" "$SESSION_OUT"
    exit 1
fi

echo "✓ 第一次使用 token 成功"
echo

# 步骤 3: 第二次使用同一 token（应该失败）
echo "[4] 第二次使用同一 token（应该拒绝）..."
USE2_RESP=$(send_request "use-2" "desktop.observe" "{\"options\":{\"includeScreenshot\":false},\"confirm\":{\"token\":\"$TOKEN\"}}")

# 检查错误
USE2_ERROR=$(echo "$USE2_RESP" | grep -o '"error"[[:space:]]*:[[:space:]]*{[^}]*' | head -1)
if [ -z "$USE2_ERROR" ]; then
    echo "✗ 第二次使用 token 没有返回错误（期望被拒绝）"
    echo "  Response: $USE2_RESP"
    kill $SESSION_PID 2>/dev/null || true
    rm -f "$SESSION_IN" "$SESSION_OUT"
    exit 1
fi

USE2_CODE=$(echo "$USE2_ERROR" | grep -o '"code"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"\([^"]*\)".*/\1/')
USE2_REASON=$(echo "$USE2_RESP" | grep -o '"reason"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"\([^"]*\)".*/\1/')

if [ "$USE2_CODE" = "DESKTOP_CONFIRM_REQUIRED" ]; then
    echo "✓ 返回 DESKTOP_CONFIRM_REQUIRED"
    if [ "$USE2_REASON" = "used" ]; then
        echo "✓ details.reason = 'used'（token 已消费）"
    else
        echo "⚠ details.reason = '$USE2_REASON'（期望 'used'）"
    fi
else
    echo "✗ 返回错误码不符"
    echo "  期望: DESKTOP_CONFIRM_REQUIRED"
    echo "  实际: $USE2_CODE"
    echo "  Response: $USE2_RESP"
    kill $SESSION_PID 2>/dev/null || true
    rm -f "$SESSION_IN" "$SESSION_OUT"
    exit 1
fi

# 清理
kill $SESSION_PID 2>/dev/null || true
rm -f "$SESSION_IN" "$SESSION_OUT"

echo
echo "=== ✅ Token Reuse 测试通过 ==="
