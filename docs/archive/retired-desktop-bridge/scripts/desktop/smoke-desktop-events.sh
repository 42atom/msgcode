#!/bin/bash
# smoke-desktop-events.sh
# T10 验收脚本：检查 events.ndjson 事件流
#
# 验收标准：
# 1. evidence.dir 下存在 events.ndjson
# 2. events.ndjson 包含 desktop.start 事件
# 3. events.ndjson 包含 desktop.stop 事件

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

WORKSPACE="${1:-$PROJECT_ROOT}"
DESKTOPCTL="${MSGCODE_DESKTOPCTL_PATH:-$PROJECT_ROOT/mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl}"

echo "=== T10 事件流验收测试 ==="
echo ""

# 检查 desktopctl 是否存在
if [ ! -f "$DESKTOPCTL" ]; then
    echo "desktopctl 不存在: $DESKTOPCTL"
    echo "请先构建 msgcode-desktopctl"
    exit 1
fi

echo "步骤 1: 发起 desktop.observe 请求..."
# 发起 observe 请求
RESULT=$("$DESKTOPCTL" rpc desktop.observe "$WORKSPACE" 2>&1)
echo "$RESULT"

# 提取 executionId
EXECUTION_ID=$(echo "$RESULT" | grep -o '"executionId"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$EXECUTION_ID" ]; then
    echo "无法获取 executionId"
    exit 1
fi

echo ""
echo "executionId: $EXECUTION_ID"
echo ""

# 查找 evidence 目录（遍历最近 3 天）
echo "步骤 2: 查找 evidence 目录..."
EVIDENCE_DIR=""

for i in {0..2}; do
    DATE=$(date -v-${i}d +%Y-%m-%d 2>/dev/null || date -d "${i} days ago" +%Y-%m-%d 2>/dev/null)
    CANDIDATE="$WORKSPACE/artifacts/desktop/$DATE/$EXECUTION_ID"

    if [ -d "$CANDIDATE" ]; then
        EVIDENCE_DIR="$CANDIDATE"
        break
    fi
done

if [ -z "$EVIDENCE_DIR" ]; then
    echo "未找到 evidence 目录"
    exit 1
fi

echo "✓ evidence 目录: $EVIDENCE_DIR"
echo ""

# 检查 events.ndjson 存在性
echo "步骤 3: 检查 events.ndjson 存在性..."
EVENTS_PATH="$EVIDENCE_DIR/events.ndjson"

if [ ! -f "$EVENTS_PATH" ]; then
    echo "events.ndjson 不存在: $EVENTS_PATH"
    exit 1
fi

echo "✓ events.ndjson 存在"
echo ""

# 检查 desktop.start 事件
echo "步骤 4: 检查 desktop.start 事件..."
if ! grep -q '"type"[[:space:]]*:[[:space:]]*"desktop\.start"' "$EVENTS_PATH"; then
    echo "events.ndjson 缺少 desktop.start 事件"
    echo "内容预览:"
    head -n 5 "$EVENTS_PATH" || true
    exit 1
fi

echo "✓ 包含 desktop.start 事件"
echo ""

# 检查 desktop.stop 事件
echo "步骤 5: 检查 desktop.stop 事件..."
if ! grep -q '"type"[[:space:]]*:[[:space:]]*"desktop\.stop"' "$EVENTS_PATH"; then
    echo "events.ndjson 缺少 desktop.stop 事件"
    echo "内容预览:"
    tail -n 5 "$EVENTS_PATH" || true
    exit 1
fi

echo "✓ 包含 desktop.stop 事件"
echo ""

# 检查 desktop.observe 事件（T10 特定）
echo "步骤 6: 检查 desktop.observe 事件..."
if grep -q '"type"[[:space:]]*:[[:space:]]*"desktop\.observe"' "$EVENTS_PATH"; then
    echo "✓ 包含 desktop.observe 事件"

    # 显示 observe 事件内容
    echo ""
    echo "desktop.observe 事件内容:"
    grep '"type"[[:space:]]*:[[:space:]]*"desktop\.observe"' "$EVENTS_PATH" | python3 -m json.tool 2>/dev/null || grep '"type"[[:space:]]*:[[:space:]]*"desktop\.observe"' "$EVENTS_PATH"
else
    echo "未包含 desktop.observe 事件（可选）"
fi

echo ""
echo "=== T10 事件流验收测试通过 ==="
echo ""
echo "完整 events.ndjson 内容:"
echo "----------------------------------------"
cat "$EVENTS_PATH"
echo "----------------------------------------"
