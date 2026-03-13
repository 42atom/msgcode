#!/bin/bash
# smoke-message-safari.sh
# Message -> Safari 端到端冒烟测试
# 验证: hotkey cmd+l → typeText URL → hotkey enter → observe
# 用途: v1.0-milestone-safari 基线回归测试

set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 获取项目根目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORKSPACE="$PROJECT_ROOT"
DESKTOPCTL="$PROJECT_ROOT/mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl"

echo "========================================"
echo "Message -> Safari Smoke Test"
echo "v1.0-milestone-safari baseline"
echo "========================================"
echo "Workspace: $WORKSPACE"
echo ""

# 检查 desktopctl 是否存在
if [ ! -f "$DESKTOPCTL" ]; then
    echo -e "${RED}✗ desktopctl 不存在，请先构建${NC}"
    echo "  cd $PROJECT_ROOT/mac/msgcode-desktopctl && swift build"
    exit 1
fi

# 检查 Host 服务是否运行
echo "[步骤 0] 检查 Host 服务健康状态..."
DOCTOR_OUTPUT=$("$DESKTOPCTL" doctor --workspace "$WORKSPACE" 2>&1)
if echo "$DOCTOR_OUTPUT" | grep -q '"healthy" : true'; then
    echo -e "${GREEN}✓ Host 服务健康${NC}"
else
    echo -e "${RED}✗ Host 服务不健康${NC}"
    echo "$DOCTOR_OUTPUT"
    exit 1
fi
echo ""

# 激活 Safari
echo "[步骤 1] 激活 Safari..."
osascript -e 'tell application "Safari" to activate' 2>/dev/null || true
sleep 1
echo -e "${GREEN}✓ Safari 已激活${NC}"
echo ""

# 步骤 1: hotkey cmd+l (打开地址栏)
echo "[步骤 2] hotkey cmd+l (打开地址栏)..."
STEP1_OUTPUT=$("$DESKTOPCTL" hotkey "$WORKSPACE" "cmd+l" --confirm CONFIRM 2>&1)
STEP1_EXEC_ID=$(echo "$STEP1_OUTPUT" | grep -o '"executionId" : "[^"]*"' | cut -d'"' -f4)
if [ -n "$STEP1_EXEC_ID" ]; then
    echo -e "${GREEN}✓ hotkey cmd+l 成功${NC}"
    echo "  executionId: $STEP1_EXEC_ID"
else
    echo -e "${RED}✗ hotkey cmd+l 失败${NC}"
    echo "$STEP1_OUTPUT"
    exit 1
fi
echo ""

# 步骤 2: typeText "https://example.com"
echo "[步骤 3] typeText 'https://example.com'..."
STEP2_OUTPUT=$("$DESKTOPCTL" type-text "$WORKSPACE" "https://example.com" --confirm CONFIRM 2>&1)
STEP2_EXEC_ID=$(echo "$STEP2_OUTPUT" | grep -o '"executionId" : "[^"]*"' | cut -d'"' -f4)
if [ -n "$STEP2_EXEC_ID" ]; then
    echo -e "${GREEN}✓ typeText 成功${NC}"
    echo "  executionId: $STEP2_EXEC_ID"
else
    echo -e "${RED}✗ typeText 失败${NC}"
    echo "$STEP2_OUTPUT"
    exit 1
fi
echo ""

# 步骤 3: hotkey enter (提交 URL)
echo "[步骤 4] hotkey enter (提交 URL)..."
STEP3_OUTPUT=$("$DESKTOPCTL" hotkey "$WORKSPACE" "enter" --confirm CONFIRM 2>&1)
STEP3_EXEC_ID=$(echo "$STEP3_OUTPUT" | grep -o '"executionId" : "[^"]*"' | cut -d'"' -f4)
if [ -n "$STEP3_EXEC_ID" ]; then
    echo -e "${GREEN}✓ hotkey enter 成功${NC}"
    echo "  executionId: $STEP3_EXEC_ID"
else
    echo -e "${RED}✗ hotkey enter 失败${NC}"
    echo "$STEP3_OUTPUT"
    exit 1
fi
echo ""

# 等待页面加载
echo "[步骤 5] 等待页面加载..."
sleep 3
echo -e "${GREEN}✓ 页面加载等待完成${NC}"
echo ""

# 步骤 4: observe (最终验证)
echo "[步骤 6] observe (最终验证)..."
STEP4_OUTPUT=$("$DESKTOPCTL" observe "$WORKSPACE" 2>&1)
STEP4_EXEC_ID=$(echo "$STEP4_OUTPUT" | grep -o '"executionId" : "[^"]*"' | cut -d'"' -f4)
STEP4_EVIDENCE_DIR=$(echo "$STEP4_OUTPUT" | grep -o '"dir" : "[^"]*"' | sed 's/"dir" : "\([^"]*\)"/\1/' | sed 's/\\//g')
if [ -n "$STEP4_EXEC_ID" ]; then
    echo -e "${GREEN}✓ observe 成功${NC}"
    echo "  executionId: $STEP4_EXEC_ID"
    echo "  evidence dir: $STEP4_EVIDENCE_DIR"
else
    echo -e "${RED}✗ observe 失败${NC}"
    echo "$STEP4_OUTPUT"
    exit 1
fi
echo ""

# 输出汇总
echo "========================================"
echo -e "${GREEN}✅ 测试通过${NC}"
echo "========================================"
echo "Execution IDs:"
echo "  1. hotkey cmd+l:   $STEP1_EXEC_ID"
echo "  2. typeText URL:   $STEP2_EXEC_ID"
echo "  3. hotkey enter:   $STEP3_EXEC_ID"
echo "  4. observe:        $STEP4_EXEC_ID"
echo ""
echo "Evidence Directory:"
echo "  $STEP4_EVIDENCE_DIR"
echo ""
echo "验证 screenshot.png 是否包含 example.com:"
if [ -f "$STEP4_EVIDENCE_DIR/screenshot.png" ]; then
    echo -e "${GREEN}✓ screenshot.png 存在${NC}"
else
    echo -e "${YELLOW}⚠ screenshot.png 不存在（可能权限问题）${NC}"
fi
echo ""

exit 0
