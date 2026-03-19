#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew 缺失；请先执行默认层安装。" >&2
  exit 2
fi

brew bundle --file "$ROOT_DIR/Brewfile.agent"
echo "可选 agent 工具集安装完成。继续执行：sh $ROOT_DIR/doctor-agent-pack.sh"
