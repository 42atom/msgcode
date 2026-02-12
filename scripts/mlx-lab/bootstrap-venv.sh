#!/usr/bin/env bash
# msgcode: MLX 实验环境 bootstrap
#
# 目的：确保 MLX LM Server 在项目内 venv 中可用，避免全局 Python 环境漂移
#
# 使用：
#   ./scripts/mlx-lab/bootstrap-venv.sh
#   或覆盖 venv 路径： VENV_DIR=./venv ./bootstrap-venv.sh

set -euo pipefail

# ============================================
# 配置
# ============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# 默认 venv 位置（可通过环境变量覆盖）
VENV_DIR="${VENV_DIR:-$PROJECT_ROOT/venv}"

# MLX 版本要求
MLX_MIN_VERSION="0.20.0"  # MLX LM Server 最低版本

# 颜期 MLX 可执行文件
MLX_SERVER="$VENV_DIR/bin/mlx_lm.server"

# 颜期的模型路径（可选校验）
MODEL_PATH="${MLX_MODEL_PATH:-}"

echo "=========================================="
echo "MLX 实验环境 Bootstrap"
echo "=========================================="
echo "项目根目录: $PROJECT_ROOT"
echo "Venv 目录: $VENV_DIR"
echo ""

# ============================================
# 1. 检查现有 venv
# ============================================

if [ -d "$VENV_DIR" ]; then
    echo "✓ Venv 已存在: $VENV_DIR"

    # 检查是否为 Python 3 venv
    if [ -f "$VENV_DIR/bin/python3" ]; then
        PYTHON_VERSION=$("$VENV_DIR/bin/python3" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
        echo "  Python 版本: $PYTHON_VERSION"
    fi

    # 检查 MLX 是否已安装
    if [ -f "$MLX_SERVER" ]; then
        echo "  ✓ MLX LM Server 已安装"

        # 验证版本
        MLX_VERSION=$("$VENV_DIR/bin/python3" -m mlx_lm --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "unknown")
        echo "    MLX 版本: $MLX_VERSION"
    else
        echo "  ✗ MLX LM Server 未安装"
        echo ""
        echo "需要安装 MLX..."
        NEEDS_INSTALL=true
    fi
else
    echo "✗ Venv 不存在: $VENV_DIR"
    echo ""
    echo "需要创建 venv 并安装 MLX..."
    NEEDS_INSTALL=true
    NEEDS_VENV=true
fi

# ============================================
# 2. 安装/升级 MLX
# ============================================

if [ "${NEEDS_INSTALL:-false}" = true ]; then
    echo ""
    echo "=========================================="
    echo "安装 MLX LM Server"
    echo "=========================================="

    if [ "${NEEDS_VENV:-false}" = true ]; then
        echo "创建 venv..."
        python3 -m venv "$VENV_DIR"
        echo "✓ Venv 创建完成"
    fi

    echo ""
    echo "安装 MLX LM Server..."
    echo "  这可能需要几分钟..."

    # 使用项目内 venv 的 pip 安装
    "$VENV_DIR/bin/pip" install --upgrade 'mlx-lm>=0.20.0' 2>&1 | while IFS= read -r line; do
        echo "  $line"
    done

    echo ""
    echo "✓ MLX LM Server 安装完成"

    # 验证安装
    if [ -f "$MLX_SERVER" ]; then
        MLX_VERSION=$("$VENV_DIR/bin/python3" -m mlx_lm --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1 || echo "unknown")
        echo "  MLX 版本: $MLX_VERSION"
    else
        echo "✗ 安装失败：未找到 $MLX_SERVER"
        exit 1
    fi
fi

# ============================================
# 3. 校验模型路径（如果设置了）
# ============================================

if [ -n "$MODEL_PATH" ]; then
    echo ""
    echo "=========================================="
    echo "校验模型路径"
    echo "=========================================="
    echo "模型路径: $MODEL_PATH"

    if [ -d "$MODEL_PATH" ]; then
        echo "✓ 模型目录存在"
    else
        echo "✗ 模型目录不存在"
        echo ""
        echo "请设置 MLX_MODEL_PATH 指向有效模型："
        echo "  export MLX_MODEL_PATH=/path/to/model"
        exit 1
    fi
fi

# ============================================
# 4. 输出环境变量提示
# ============================================

echo ""
echo "=========================================="
echo "Bootstrap 完成"
echo "=========================================="
echo ""
echo "使用方式："
echo ""
echo "  1. 设置环境变量（推荐）："
echo "     export PATH=\"$VENV_DIR/bin:\$PATH\""
echo ""
echo "  2. 或直接使用 venv 启动："
echo "     \"$VENV_DIR/bin/python\" -m mlx_lm.server --model /path/to/model --port 18000"
echo ""
echo "  3. 运行冒烟测试："
echo "     PATH=\"$VENV_DIR/bin:\$PATH\" MLX_MODEL_PATH=/path/to/model bash scripts/mlx-lab/smoke-all.sh"
echo ""
echo "Venv 位置: $VENV_DIR"
echo "MLX Server: $MLX_SERVER"
echo ""
