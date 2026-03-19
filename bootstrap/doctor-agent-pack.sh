#!/bin/sh
set -eu

MISSING=""

for cmd in tmux uv bun rg fd jq fzf bat eza; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    MISSING="$MISSING $cmd"
  fi
done

if [ -n "$MISSING" ]; then
  echo "可选 agent 工具集缺失:$MISSING" >&2
  exit 2
fi

echo "agent_toolset=ok"
