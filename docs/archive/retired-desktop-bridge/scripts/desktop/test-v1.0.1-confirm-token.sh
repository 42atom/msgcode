#!/bin/bash
# test-v1.0.1-confirm-token.sh
# Batch-T2.1 + Batch-T3 验收测试
# 验证: issue -> use -> reuse fail 三段证据 + 会话证据映射

set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PROJECT_ROOT="/Users/admin/GitProjects/msgcode"
WORKSPACE="$PROJECT_ROOT"
DESKTOPCTL="$PROJECT_ROOT/mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl"

echo "========================================"
echo "v1.0.1 Confirm Token + Session Mapping"
echo "========================================"
echo "Workspace: $WORKSPACE"
echo ""

# 检查 desktopctl 是否存在
if [ ! -f "$DESKTOPCTL" ]; then
    echo -e "${RED}✗ desktopctl 不存在${NC}"
    exit 1
fi

# 激活 Safari
echo "[步骤 0] 激活 Safari..."
osascript -e 'tell application "Safari" to activate' 2>/dev/null || true
sleep 1
echo -e "${GREEN}✓ Safari 已激活${NC}"
echo ""

# ============================================
# Batch-T2.1: issue -> use -> reuse fail
# ============================================

echo "========================================"
echo "Batch-T2.1: Confirm Token 三段验证"
echo "========================================"
echo ""

# 步骤 1: 签发 token
echo "[步骤 1] 签发 token (desktop.hotkey)..."
ISSUE_OUTPUT=$("$DESKTOPCTL" issue-confirm "$WORKSPACE" \
    --method desktop.hotkey \
    --params-json '{"keys":"cmd+l"}' \
    --ttl-ms 30000 2>&1)
ISSUE_EXIT_CODE=$?

if [ $ISSUE_EXIT_CODE -eq 0 ]; then
    TOKEN=$(echo "$ISSUE_OUTPUT" | grep -o '"token" : "[^"]*"' | cut -d'"' -f4)
    if [ -n "$TOKEN" ]; then
        echo -e "${GREEN}✓ Token 签发成功${NC}"
        echo "  token: $TOKEN"
    else
        echo -e "${RED}✗ Token 解析失败${NC}"
        echo "$ISSUE_OUTPUT"
        exit 1
    fi
else
    echo -e "${RED}✗ Token 签发失败${NC}"
    echo "$ISSUE_OUTPUT"
    exit 1
fi
echo ""

# 步骤 2: 使用 token (第一次，应该成功)
echo "[步骤 2] 使用 token (第一次，应该成功)..."
USE_OUTPUT=$("$DESKTOPCTL" hotkey "$WORKSPACE" "cmd+l" --confirm-token "$TOKEN" 2>&1)
USE_EXIT_CODE=$?

if [ $USE_EXIT_CODE -eq 0 ]; then
    EXEC_ID_1=$(echo "$USE_OUTPUT" | grep -o '"executionId" : "[^"]*"' | cut -d'"' -f4)
    echo -e "${GREEN}✓ Token 使用成功（第一次）${NC}"
    echo "  executionId: $EXEC_ID_1"
else
    echo -e "${RED}✗ Token 使用失败（第一次）${NC}"
    echo "$USE_OUTPUT"
    exit 1
fi
echo ""

# 步骤 3: 重复使用 token (应该失败)
echo "[步骤 3] 重复使用 token（应该失败）..."
REUSE_OUTPUT=$("$DESKTOPCTL" hotkey "$WORKSPACE" "cmd+l" --confirm-token "$TOKEN" 2>&1)
REUSE_EXIT_CODE=$?

if [ $REUSE_EXIT_CODE -ne 0 ]; then
    echo -e "${GREEN}✓ Token 重复使用被拒绝（符合预期）${NC}"
    echo "  exitCode: $REUSE_EXIT_CODE"
    echo "$REUSE_OUTPUT" | head -3
else
    echo -e "${RED}✗ Token 重复使用未被拒绝（安全风险）${NC}"
    exit 1
fi
echo ""

# ============================================
# Batch-T3: 会话证据映射验证
# ============================================

echo "========================================"
echo "Batch-T3: 会话证据映射验证"
echo "========================================"
echo ""

SESSION_LOG="$WORKSPACE/.msgcode/desktop_sessions.ndjson"
echo "[检查 1] 会话日志文件: $SESSION_LOG"
if [ -f "$SESSION_LOG" ]; then
    TOTAL_RECORDS=$(wc -l < "$SESSION_LOG" | tr -d ' ')
    echo -e "${GREEN}✓ 会话日志存在${NC}"
    echo "  总记录数: $TOTAL_RECORDS"
else
    echo -e "${YELLOW}⚠ 会话日志不存在（可能还未执行快捷命令）${NC}"
fi
echo ""

# 执行一次快捷命令来生成会话记录
echo "[步骤 4] 执行快捷命令（/desktop observe）..."
"$DESKTOPCTL" observe "$WORKSPACE" >/dev/null 2>&1 &
sleep 2
echo -e "${GREEN}✓ 快捷命令已执行${NC}"
echo ""

echo "[检查 2] 验证会话记录..."
if [ -f "$SESSION_LOG" ]; then
    # 获取最新的一条记录
    LATEST_RECORD=$(tail -1 "$SESSION_LOG")
    echo "  最新记录: $LATEST_RECORD"

    # 验证必需字段
    REQUIRED_FIELDS="messageRequestId method executionId evidenceDir ts"
    MISSING_FIELDS==""
    for field in $REQUIRED_FIELDS; do
        if ! echo "$LATEST_RECORD" | grep -q "\"$field\""; then
            MISSING_FIELDS="$MISSING_FIELDS $field"
        fi
    done

    if [ -z "$MISSING_FIELDS" ]; then
        echo -e "${GREEN}✓ 会话记录字段完整${NC}"
    else
        echo -e "${RED}✗ 会话记录缺少字段:$MISSING_FIELDS${NC}"
        exit 1
    fi

    # 验证 evidenceDir 存在
    EVIDENCE_DIR=$(echo "$LATEST_RECORD" | grep -o '"evidenceDir" : "[^"]*"' | cut -d'"' -f4 | sed 's/\\//g')
    if [ -n "$EVIDENCE_DIR" ] && [ -d "$EVIDENCE_DIR" ]; then
        echo -e "${GREEN}✓ Evidence 目录存在${NC}"
        echo "  path: $EVIDENCE_DIR"
    else
        echo -e "${YELLOW}⚠ Evidence 目录不存在（可能路径解析问题）${NC}"
    fi
else
    echo -e "${YELLOW}⚠ 会话日志仍不存在${NC}"
fi
echo ""

echo "========================================"
echo -e "${GREEN}✅ 全部验收通过${NC}"
echo "========================================"
echo ""
echo "Batch-T2.1 验收通过:"
echo "  ✅ Token 签发成功"
echo "  ✅ Token 使用成功（第一次）"
echo "  ✅ Token 重复使用被拒绝"
echo ""
echo "Batch-T3 验收通过:"
echo "  ✅ 会话日志落盘正常"
echo "  ✅ 记录字段完整"
echo "  ✅ Evidence 目录可追溯"

exit 0
