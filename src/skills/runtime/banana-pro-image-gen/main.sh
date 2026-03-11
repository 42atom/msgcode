#!/usr/bin/env bash
set -euo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$skill_dir"

sub="${1:-generate}"
shift || true

case "$sub" in
  generate|edit|describe)
    exec node scripts/banana-pro-client.js "$sub" "$@"
    ;;
  *)
    echo "Usage: banana-pro-image-gen <generate|edit|describe> ..." >&2
    exit 2
    ;;
esac
