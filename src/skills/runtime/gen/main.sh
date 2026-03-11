#!/usr/bin/env bash
set -euo pipefail

sub="${1:-}"
if [[ -z "$sub" ]]; then
  echo "Usage: gen <image|selfie|tts|music> ..." >&2
  exit 2
fi
shift || true

case "$sub" in
  image|selfie|tts|music)
    exec msgcode gen "$sub" "$@"
    ;;
  *)
    echo "Unsupported gen subcommand: $sub" >&2
    exit 2
    ;;
esac
