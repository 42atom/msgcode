#!/usr/bin/env bash
# ============================================
# imsg 源码构建脚本
# ============================================
# 用途：从固定版本源码构建 imsg 二进制
# 产物：vendor/imsg/v0.4.0/imsg
# ============================================

set -euo pipefail

# ============================================
# 配置（版本固定策略）
# ============================================
REPO="https://github.com/steipete/imsg.git"
VERSION="v0.4.0"
COMMIT="7a93d64881bc6c97df6e1d097b4a129ff61da895"
EXPECTED_HASH="d0e5e333ee88192d595bfed9eece60e35ecad0300145966d5ad27458c33e407b"

# 获取脚本所在目录的父目录（msgcode 项目根目录）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 产物目录
VENDOR_DIR="$PROJECT_ROOT/vendor/imsg/$VERSION"
OUTPUT_BINARY="$VENDOR_DIR/imsg"
HASH_FILE="$VENDOR_DIR/imsg.sha256"

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
    echo "[SUCCESS] $*"
}

check_command() {
    local cmd="$1"
    if ! command -v "$cmd" &>/dev/null; then
        log_error "$cmd 未安装"
        return 1
    fi
}

# ============================================
# 环境检查
# ============================================

log_info "检查构建环境..."

# Swift 工具链
if ! check_command swift; then
    log_error "请安装 Xcode Command Line Tools: xcode-select --install"
    exit 1
fi

# Python 3（补丁脚本需要）
if ! check_command python3; then
    log_error "请安装 Python 3: brew install python3"
    exit 1
fi

# Git
if ! check_command git; then
    log_error "请安装 Git"
    exit 1
fi

# codesign（macOS 自带，应该总是可用）
if ! check_command codesign; then
    log_error "codesign 不可用（异常情况）"
    exit 1
fi

log_success "环境检查通过"

# ============================================
# 创建临时构建目录
# ============================================

BUILD_DIR=$(mktemp -d)
trap 'rm -rf "$BUILD_DIR"' EXIT

log_info "创建临时构建目录: $BUILD_DIR"

# ============================================
# Clone 源码
# ============================================

log_info "Clone imsg 仓库..."
cd "$BUILD_DIR"
git clone "$REPO" imsg
cd imsg

# ============================================
# Pin 到固定版本
# ============================================

log_info "Pin 到版本 $VERSION (commit: $COMMIT)..."

git fetch --tags
git checkout "$VERSION"
git checkout -b "pinned-$VERSION" "$COMMIT"

# 验证 commit
ACTUAL_COMMIT=$(git rev-parse HEAD)
if [ "$ACTUAL_COMMIT" != "$COMMIT" ]; then
    log_error "Commit 校验失败: 期望 $COMMIT, 实际 $ACTUAL_COMMIT"
    exit 1
fi

log_success "版本校验通过"

# ============================================
# 创建 version.env
# ============================================

log_info "创建 version.env..."

# 解析版本号（去掉 v 前缀）
MARKETING_VERSION="${VERSION#v}"

cat > version.env <<EOF
MARKETING_VERSION=$MARKETING_VERSION
CURRENT_PROJECT_VERSION=1
EOF

# ============================================
# 执行构建
# ============================================

log_info "开始构建 (universal binary: arm64 + x86_64)..."

# 设置匿名签名（避免代码签名弹窗）
export CODESIGN_IDENTITY="-"

# 使用 upstream Makefile 构建
if ! make build; then
    log_error "构建失败"
    log_error "提示: 运行 'swift package clean' 后重试"
    exit 1
fi

# 检查产物
if [ ! -f "./bin/imsg" ]; then
    log_error "构建产物不存在: ./bin/imsg"
    exit 1
fi

log_success "构建完成"

# ============================================
# 安装到 vendor 目录
# ============================================

log_info "安装产物到 vendor 目录..."

mkdir -p "$VENDOR_DIR"

# 如果已存在旧二进制，先备份
if [ -f "$OUTPUT_BINARY" ]; then
    BACKUP_PATH="${OUTPUT_BINARY}.backup.$(date +%s)"
    log_info "备份现有二进制: $BACKUP_PATH"
    cp "$OUTPUT_BINARY" "$BACKUP_PATH"
fi

# 复制二进制
cp ./bin/imsg "$OUTPUT_BINARY"

# 复制依赖的 bundle（如果有）
for bundle in .build/*/release/*.bundle; do
    if [ -e "$bundle" ]; then
        BUNDLE_NAME=$(basename "$bundle")
        log_info "复制 bundle: $BUNDLE_NAME"
        cp -R "$bundle" "$VENDOR_DIR/"
    fi
done

# ============================================
# 生成 hash 记录
# ============================================

log_info "生成 SHA256 hash..."

ACTUAL_HASH=$(shasum -a 256 "$OUTPUT_BINARY" | cut -d' ' -f1)
echo "$ACTUAL_HASH  imsg" > "$HASH_FILE"

log_success "Hash: $ACTUAL_HASH"

# 如果有预期 hash，进行对比
if [ -n "$EXPECTED_HASH" ]; then
    if [ "$ACTUAL_HASH" = "$EXPECTED_HASH" ]; then
        log_success "Hash 与 release zip 一致"
    else
        log_info "Hash 与 release zip 不同（预期: $EXPECTED_HASH）"
        log_info "这可能由于 universal 构建与 release 构建有差异"
    fi
fi

# ============================================
# 生成版本信息文件
# ============================================

cat > "$VENDOR_DIR/build-info.json" <<EOF
{
  "version": "$VERSION",
  "commit": "$COMMIT",
  "buildDate": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "buildHost": "$(hostname)",
  "sha256": "$ACTUAL_HASH"
}
EOF

# ============================================
# 打印配置提示
# ============================================

echo ""
log_success "imsg 构建完成！"
echo ""
echo "产物位置:"
echo "  二进制: $OUTPUT_BINARY"
echo "  Hash:   $HASH_FILE"
echo "  信息:   $VENDOR_DIR/build-info.json"
echo ""
echo "请在 .env 或 ~/.config/msgcode/.env 中添加:"
echo "  IMSG_PATH=$OUTPUT_BINARY"
echo ""
echo "校验产物:"
echo "  ./scripts/verify-imsg.sh"
echo ""
