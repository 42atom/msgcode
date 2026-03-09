#!/usr/bin/env bash
set -euo pipefail

resolve_script() {
  local candidates=(
    "$HOME/.agents/skills/zai-vision-mcp/scripts/zai_vision_mcp.mjs"
    "$HOME/.codex/skills/zai-vision-mcp/scripts/zai_vision_mcp.mjs"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

if [[ $# -lt 1 ]]; then
  echo "Usage: zai-vision-mcp <list|call> [args...]" >&2
  exit 2
fi

script_path="$(resolve_script || true)"
if [[ -z "$script_path" ]]; then
  echo "zai-vision-mcp: zai_vision_mcp.mjs not found in ~/.agents or ~/.codex skills" >&2
  exit 1
fi

exec node "$script_path" "$@"
