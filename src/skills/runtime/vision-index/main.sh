#!/usr/bin/env bash
set -euo pipefail

cat <<'EOF'
vision-index

先读：
  ~/.config/msgcode/skills/vision-index/SKILL.md

推荐顺序：
  1. 当前模型原生支持图片输入 -> 直接继续看图
  2. 本地 LM Studio Vision -> 读取对应 SKILL.md，按真实调用合同执行

系统只负责图片预览摘要；详细视觉由模型自己决定。
不要假设所有视觉 skill 都统一走 main.sh wrapper。
EOF
