#!/usr/bin/env bash
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script_path="$skill_dir/scripts/analyze_image.py"

if [[ $# -eq 0 ]]; then
  echo "Usage: local-vision-lmstudio [--print-models|--doctor|--model <key> ...] <image-path> [prompt] [extra args...]" >&2
  exit 2
fi

if [[ ! -f "$script_path" ]]; then
  echo "local-vision-lmstudio: analyze_image.py not found in runtime skill directory" >&2
  exit 1
fi

exec python3 "$script_path" "$@"
