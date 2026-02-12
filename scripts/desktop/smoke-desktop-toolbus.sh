#!/bin/bash
# msgcode Desktop Tool Bus 验收脚本
# Batch-T6.3

set -euo pipefail

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 工作区路径（参数 1 或 PWD）
WORKSPACE="${1:-$(pwd)}"
WS="$(cd "$WORKSPACE" && pwd)"

echo "========================================"
echo "msgcode Desktop Tool Bus 验收测试"
echo "========================================"
echo "工作区: $WS"
echo ""

# ============================================
# 检查 desktopctl 是否构建
# ============================================
echo "[1/5] 检查 msgcode-desktopctl 构建状态..."

# 智能路径检测：workspace 可能是项目根目录或外部目录
if [ -f "$WS/mac/msgcode-desktopctl/.build/release/msgcode-desktopctl" ]; then
    # workspace 就是项目根目录
    PROJECT_ROOT="$WS"
elif [ -f "$WS/mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl" ]; then
    PROJECT_ROOT="$WS"
else
    # workspace 是外部目录，向上查找 mac 项目
    PROJECT_ROOT="$(cd "$WS/../.." && pwd)"
fi

RELEASE_CTL="$PROJECT_ROOT/mac/msgcode-desktopctl/.build/release/msgcode-desktopctl"
DEBUG_CTL="$PROJECT_ROOT/mac/msgcode-desktopctl/.build/debug/msgcode-desktopctl"

if [ -f "$RELEASE_CTL" ]; then
    DESKTOPCTL="$RELEASE_CTL"
    echo "✓ 找到 release 版本: $DESKTOPCTL"
elif [ -f "$DEBUG_CTL" ]; then
    DESKTOPCTL="$DEBUG_CTL"
    echo "✓ 找到 debug 版本: $DESKTOPCTL"
else
    echo "✗ 未找到 msgcode-desktopctl"
    echo ""
    echo "请先构建:"
    echo "  cd $PROJECT_ROOT/mac/msgcode-desktopctl"
    echo "  swift build"
    echo ""
    echo "或使用 release 模式:"
    echo "  swift build -c release"
    exit 2
fi
echo ""

# ============================================
# 运行 desktopctl ping
# ============================================
echo "[2/5] 测试 desktopctl ping..."
# T6.4.3: 临时 set +e 确保能捕获非 0 exit
set +e
PING_OUTPUT="$("$DESKTOPCTL" ping --workspace "$WS" 2>&1)"
PING_EXIT=$?
set -e

if [ $PING_EXIT -eq 0 ]; then
    echo "✓ ping 成功 (exit 0)"
else
    echo "✗ ping 失败 (exit $PING_EXIT)"
    echo "输出: $PING_OUTPUT"
    exit 2
fi
# 解析并打印 permissions
if echo "$PING_OUTPUT" | python3 -c "import sys, json; d=json.load(sys.stdin); print('  permissions:', d['result']['permissions'])" 2>/dev/null; then
    : # permissions 已由 python 打印
else
    echo "  permissions: (解析失败，原始输出见上)"
fi
echo ""

# ============================================
# 运行 desktopctl doctor
# ============================================
echo "[3/5] 测试 desktopctl doctor..."
# T6.4.3: 临时 set +e 确保能捕获非 0 exit
set +e
DOCTOR_OUTPUT="$("$DESKTOPCTL" doctor --workspace "$WS" 2>&1)"
DOCTOR_EXIT=$?
set -e

if [ $DOCTOR_EXIT -eq 0 ]; then
    echo "✓ doctor 成功 (exit 0)"
else
    echo "✗ doctor 失败 (exit $DOCTOR_EXIT)"
    echo "输出: $DOCTOR_OUTPUT"
    exit 2
fi

# 解析并打印 permissions/issues
if echo "$DOCTOR_OUTPUT" | python3 -c "import sys, json; d=json.load(sys.stdin); r=d['result']; print('  healthy:', r['healthy']); print('  issues:', r.get('issues', []))" 2>/dev/null; then
    : # 已由 python 打印
else
    echo "  healthy: (解析失败，原始输出见上)"
fi
echo ""

# ============================================
# 运行 desktopctl observe
# ============================================
echo "[4/5] 测试 desktopctl observe..."
# T6.4.3: 临时 set +e 确保能捕获非 0 exit
set +e
OBSERVE_OUTPUT="$("$DESKTOPCTL" observe "$WS" --timeout-ms 60000 2>&1)"
OBSERVE_EXIT=$?
set -e

if [ $OBSERVE_EXIT -eq 0 ]; then
    echo "✓ observe 成功 (exit 0)"
else
    echo "✗ observe 失败 (exit $OBSERVE_EXIT)"
    echo "输出: $OBSERVE_OUTPUT"
    exit 2
fi

# 解析 evidence.dir 和 permissionsMissing
EVIDENCE_DIR=""
PERMISSIONS_MISSING=""
EVIDENCE_DIR="$(echo "$OBSERVE_OUTPUT" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d['result']['evidence']['dir'])" 2>/dev/null)"
PERMISSIONS_MISSING="$(echo "$OBSERVE_OUTPUT" | python3 -c "import sys, json; d=json.load(sys.stdin); e=d['result']['evidence']; print(','.join(e.get('permissionsMissing', [])))" 2>/dev/null)"

if [ -z "$EVIDENCE_DIR" ]; then
    echo "✗ 无法解析 evidence.dir"
    exit 2
fi

echo "  evidence.dir: $EVIDENCE_DIR"

# 检查权限状态
if [ -n "$PERMISSIONS_MISSING" ]; then
    echo "  权限缺失: $PERMISSIONS_MISSING"
fi

# 解析实际生成的文件
SCREENSHOT_PATH="$(echo "$OBSERVE_OUTPUT" | python3 -c "import sys, json; d=json.load(sys.stdin); e=d['result']['evidence']; print(e.get('screenshotPath', 'null'))" 2>/dev/null)"
AX_PATH="$(echo "$OBSERVE_OUTPUT" | python3 -c "import sys, json; d=json.load(sys.stdin); e=d['result']['evidence']; print(e.get('axPath', 'null'))" 2>/dev/null)"

if [ "$SCREENSHOT_PATH" != "null" ] && [ -n "$SCREENSHOT_PATH" ]; then
    echo "  ✓ screenshotPath: $SCREENSHOT_PATH"
else
    echo "  ⚠ screenshotPath: null (需要 Screen Recording 权限)"
fi

if [ "$AX_PATH" != "null" ] && [ -n "$AX_PATH" ]; then
    echo "  ✓ axPath: $AX_PATH"
else
    echo "  ⚠ axPath: null (需要 Accessibility 权限)"
fi
echo ""

# ============================================
# 验证 evidence 落盘
# ============================================
echo "[5/5] 验证 evidence 落盘..."

ENV_JSON="$EVIDENCE_DIR/env.json"
SCREENSHOT_FILE="$EVIDENCE_DIR/observe.png"
AX_FILE="$EVIDENCE_DIR/ax.json"

if [ ! -d "$EVIDENCE_DIR" ]; then
    echo "✗ evidence 目录不存在: $EVIDENCE_DIR"
    exit 2
fi
echo "✓ evidence 目录存在"

if [ ! -f "$ENV_JSON" ]; then
    echo "✗ env.json 不存在: $ENV_JSON"
    exit 2
fi
echo "✓ env.json 存在: $ENV_JSON"

# 检查 observe.png
if [ -f "$SCREENSHOT_FILE" ]; then
    echo "✓ observe.png 存在: $SCREENSHOT_FILE"
    # 验证文件可打开（不是空文件）
    if [ -s "$SCREENSHOT_FILE" ]; then
        echo "  ✓ observe.png 非空（可打开）"
    else
        echo "  ✗ observe.png 为空"
        exit 2
    fi
else
    if [ "$SCREENSHOT_PATH" = "null" ] || [ -z "$SCREENSHOT_PATH" ]; then
        echo "⚠ observe.png 不存在（权限被拒，符合预期）"
    else
        echo "✗ observe.png 不存在但响应声称存在: $SCREENSHOT_PATH"
        exit 2
    fi
fi

# 检查 ax.json
if [ -f "$AX_FILE" ]; then
    echo "✓ ax.json 存在: $AX_FILE"
    # 验证 JSON 合法性
    if python3 -c "import json; json.load(open('$AX_FILE'))" 2>/dev/null; then
        echo "  ✓ ax.json 是合法 JSON"
        # 检查 traversal 字段
        if python3 -c "import json; d=json.load(open('$AX_FILE')); 'traversal' in d" 2>/dev/null; then
            TRAVERSAL_INFO="$(python3 -c "import json; d=json.load(open('$AX_FILE')); t=d['traversal']; print('nodes={}, depth={}ms, truncated={}'.format(t['nodesVisited'], t['elapsedMs'], t['truncated']))" 2>/dev/null)"
            echo "  ✓ traversal: $TRAVERSAL_INFO"
        else
            echo "  ⚠ ax.json 缺少 traversal 字段"
        fi
    else
        echo "  ✗ ax.json 不是合法 JSON"
        exit 2
    fi
else
    if [ "$AX_PATH" = "null" ] || [ -z "$AX_PATH" ]; then
        echo "⚠ ax.json 不存在（权限被拒，符合预期）"
    else
        echo "✗ ax.json 不存在但响应声称存在: $AX_PATH"
        exit 2
    fi
fi

# 验证 workspacePath 正确
WS_IN_ENV=$(python3 -c "import json; print(json.load(open('$ENV_JSON'))['workspacePath'])" 2>/dev/null)
if [ "$WS_IN_ENV" != "$WS" ]; then
    echo "✗ env.json 中的 workspacePath 不匹配"
    echo "  期望: $WS"
    echo "  实际: $WS_IN_ENV"
    exit 2
fi
echo "✓ env.json.workspacePath 正确"

# 验证 peer 信息存在
PEER_PID=$(python3 -c "import json; print(json.load(open('$ENV_JSON'))['peer']['pid'])" 2>/dev/null)
HOST_BUNDLE_ID=$(python3 -c "import json; print(json.load(open('$ENV_JSON'))['host']['bundleId'])" 2>/dev/null)
if [ -n "$PEER_PID" ] && [ -n "$HOST_BUNDLE_ID" ]; then
    echo "✓ peer.pid: $PEER_PID"
    echo "✓ host.bundleId: $HOST_BUNDLE_ID"
else
    echo "✗ peer 或 host 信息缺失"
    exit 2
fi

# 判断最终状态
PASS=true
if [ "$PERMISSIONS_MISSING" != "" ]; then
    PASS=false
fi

echo ""
echo "========================================"
if [ "$PASS" = "true" ]; then
    echo -e "${GREEN}PASS${NC} (权限齐全)"
else
    echo -e "${YELLOW}SKIP (权限缺失)${NC}"
    echo -e "${YELLOW}需要授权: $PERMISSIONS_MISSING${NC}"
fi
echo "========================================"
echo "证据路径:"
echo "  evidence.dir: $EVIDENCE_DIR"
echo "  env.json: $ENV_JSON"
if [ -f "$SCREENSHOT_FILE" ]; then
    echo "  observe.png: $SCREENSHOT_FILE ✓"
else
    echo "  observe.png: (不存在，需要 Screen Recording 权限)"
fi
if [ -f "$AX_FILE" ]; then
    echo "  ax.json: $AX_FILE ✓"
else
    echo "  ax.json: (不存在，需要 Accessibility 权限)"
fi
echo ""
echo "3 条 desktopctl 命令的 exitCode:"
echo "  ping:   $PING_EXIT"
echo "  doctor: $DOCTOR_EXIT"
echo "  observe: $OBSERVE_EXIT"
echo ""