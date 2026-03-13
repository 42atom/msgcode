#!/usr/bin/env bash
# ============================================
# imsg 产物校验脚本
# ============================================
# 用途：校验构建的 imsg 二进制
# 检查：存在性、Hash、版本、RPC 可用性
# ============================================

set -euo pipefail

# ============================================
# 配置
# ============================================

VERSION="v0.4.0"

# 获取脚本所在目录的父目录（msgcode 项目根目录）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 产物路径
VENDOR_DIR="$PROJECT_ROOT/vendor/imsg/$VERSION"
OUTPUT_BINARY="$VENDOR_DIR/imsg"
HASH_FILE="$VENDOR_DIR/imsg.sha256"
BUILD_INFO="$VENDOR_DIR/build-info.json"

# ============================================
# 工具函数
# ============================================

log_info() {
    echo "[INFO] $*"
}

log_error() {
    echo "[ERROR] $*" >&2
}

log_success() {
    echo "[OK] $*"
}

log_warn() {
    echo "[WARN] $*"
}

check_passed=0
check_failed=0

check() {
    local name="$1"
    shift

    if "$@"; then
        log_success "$name"
        ((check_passed++))
        return 0
    else
        log_error "$name"
        ((check_failed++))
        return 1
    fi
}

# ============================================
# 检查 1: 产物存在性
# ============================================

echo "============================================"
echo "imsg 产物校验 (版本: $VERSION)"
echo "============================================"
echo ""

check_binary_exists() {
    [ -f "$OUTPUT_BINARY" ]
}

check "产物存在性" check_binary_exists

if [ ! -f "$OUTPUT_BINARY" ]; then
    log_error "二进制不存在: $OUTPUT_BINARY"
    log_error "请先运行: ./scripts/build-imsg.sh"
    exit 1
fi

# ============================================
# 检查 2: Hash 校验
# ============================================

check_hash() {
    if [ ! -f "$HASH_FILE" ]; then
        log_warn "Hash 文件不存在: $HASH_FILE"
        return 1
    fi

    CURRENT_HASH=$(shasum -a 256 "$OUTPUT_BINARY" | cut -d' ' -f1)
    RECORDED_HASH=$(cat "$HASH_FILE" | cut -d' ' -f1)

    if [ "$CURRENT_HASH" = "$RECORDED_HASH" ]; then
        return 0
    else
        log_error "Hash 不匹配"
        log_error "  当前: $CURRENT_HASH"
        log_error "  记录: $RECORDED_HASH"
        return 1
    fi
}

check "Hash 校验" check_hash

# ============================================
# 检查 3: 二进制架构
# ============================================

check_arch() {
    local arch_info
    arch_info=$(file "$OUTPUT_BINARY")

    # 检查是否为 universal binary (包含 arm64 和 x86_64)
    if echo "$arch_info" | grep -q "arm64" && echo "$arch_info" | grep -q "x86_64"; then
        return 0
    elif echo "$arch_info" | grep -q "arm64"; then
        log_info "架构: ARM64 only"
        return 0
    elif echo "$arch_info" | grep -q "x86_64"; then
        log_info "架构: x86_64 only"
        return 0
    else
        log_error "未知架构: $arch_info"
        return 1
    fi
}

check "架构检查" check_arch

# ============================================
# 检查 4: 可执行权限
# ============================================

check_executable() {
    [ -x "$OUTPUT_BINARY" ]
}

check "可执行权限" check_executable

# 如果没有执行权限，尝试添加
if [ ! -x "$OUTPUT_BINARY" ]; then
    log_info "添加执行权限..."
    chmod +x "$OUTPUT_BINARY"
fi

# ============================================
# 检查 5: 版本号
# ============================================

check_version() {
    local version_output
    version_output=$("$OUTPUT_BINARY" --version 2>&1 || true)

    if echo "$version_output" | grep -q "${VERSION#v}"; then
        return 0
    else
        log_error "版本号不匹配"
        log_error "  期望: ${VERSION#v}"
        log_error "  实际: $version_output"
        return 1
    fi
}

check "版本号检查" check_version

# ============================================
# 检查 6: RPC 命令可用性
# ============================================

check_rpc() {
    local help_output
    help_output=$("$OUTPUT_BINARY" rpc --help 2>&1 || true)

    # 检查是否包含关键子命令
    if echo "$help_output" | grep -q "watch\|send\|chats"; then
        return 0
    else
        log_error "RPC 命令不可用"
        log_error "  输出: $help_output"
        return 1
    fi
}

check "RPC 命令检查" check_rpc

# ============================================
# 检查 7: 基本功能（需要权限）
# ============================================

check_basic_function() {
    # 尝试运行 imsg chats（可能因权限失败，这是预期的）
    local chats_output
    chats_output=$("$OUTPUT_BINARY" chats --limit 1 2>&1 || true)

    # 检查是否是权限问题（可接受）vs 严重错误（不可接受）
    if echo "$chats_output" | grep -qi "unable to open database\|permission\|full disk access"; then
        log_info "权限检查: 需要 Full Disk Access（预期行为）"
        return 0
    elif echo "$chats_output" | grep -q "\[\]"; then
        # 空数组也算正常（可能没有消息）
        return 0
    elif echo "$chats_output" | grep -qi "chat"; then
        # 有输出也算正常
        return 0
    else
        log_warn "基本功能检查结果不确定"
        log_warn "  输出: $chats_output"
        return 1
    fi
}

check "基本功能检查" check_basic_function

# ============================================
# 检查 8: 配置路径建议
# ============================================

echo ""
echo "============================================"
echo "配置建议"
echo "============================================"
echo ""

echo "在 .env 或 ~/.config/msgcode/.env 中添加:"
echo ""
echo "  IMSG_PATH=$OUTPUT_BINARY"
echo ""

# 检查是否已配置
CONFIG_SUGGESTED=false

if [ -f "$PROJECT_ROOT/.env" ]; then
    if grep -q "IMSG_PATH=" "$PROJECT_ROOT/.env"; then
        CONFIGURED_PATH=$(grep "IMSG_PATH=" "$PROJECT_ROOT/.env" | cut -d'=' -f2)
        if [ "$CONFIGURED_PATH" = "$OUTPUT_BINARY" ]; then
            log_success ".env 已正确配置 IMSG_PATH"
            CONFIG_SUGGESTED=true
        else
            log_warn ".env 中 IMSG_PATH 与当前产物不同"
            log_warn "  配置: $CONFIGURED_PATH"
            log_warn "  当前: $OUTPUT_BINARY"
        fi
    fi
fi

if [ -f "$HOME/.config/msgcode/.env" ] && [ "$CONFIG_SUGGESTED" = false ]; then
    if grep -q "IMSG_PATH=" "$HOME/.config/msgcode/.env"; then
        CONFIGURED_PATH=$(grep "IMSG_PATH=" "$HOME/.config/msgcode/.env" | cut -d'=' -f2)
        if [ "$CONFIGURED_PATH" = "$OUTPUT_BINARY" ]; then
            log_success "~/.config/msgcode/.env 已正确配置 IMSG_PATH"
            CONFIG_SUGGESTED=true
        else
            log_warn "~/.config/msgcode/.env 中 IMSG_PATH 与当前产物不同"
            log_warn "  配置: $CONFIGURED_PATH"
            log_warn "  当前: $OUTPUT_BINARY"
        fi
    fi
fi

if [ "$CONFIG_SUGGESTED" = false ]; then
    log_warn "未找到 IMSG_PATH 配置"
fi

# ============================================
# 构建信息
# ============================================

echo ""
echo "============================================"
echo "构建信息"
echo "============================================"
echo ""

if [ -f "$BUILD_INFO" ]; then
    cat "$BUILD_INFO"
else
    log_warn "构建信息文件不存在: $BUILD_INFO"
fi

# ============================================
# 总结
# ============================================

echo ""
echo "============================================"
echo "校验总结"
echo "============================================"
echo ""

log_success "通过: $check_passed 项"
if [ $check_failed -gt 0 ]; then
    log_error "失败: $check_failed 项"
    echo ""
    log_error "校验未完全通过，请检查上述失败项"
    exit 1
else
    echo ""
    log_success "所有校验通过！imsg 可以使用。"
    exit 0
fi
