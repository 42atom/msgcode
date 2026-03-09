#!/usr/bin/env bash
set -euo pipefail

resolve_script() {
  local candidates=(
    "$HOME/.agents/skills/local-vision-lmstudio/scripts/analyze_image.py"
    "$HOME/.codex/skills/local-vision-lmstudio/scripts/analyze_image.py"
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

if [[ $# -eq 0 ]]; then
  echo "Usage: local-vision-lmstudio [--print-models|--doctor|--model <key> ...] <image-path> [prompt] [extra args...]" >&2
  exit 2
fi

script_path="$(resolve_script || true)"
if [[ -z "$script_path" ]]; then
  echo "local-vision-lmstudio: analyze_image.py not found in ~/.agents or ~/.codex skills" >&2
  exit 1
fi

exec python3 "$script_path" "$@"
