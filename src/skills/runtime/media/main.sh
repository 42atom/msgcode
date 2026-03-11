#!/usr/bin/env bash
set -euo pipefail

sub="${1:-}"
if [[ -z "$sub" ]]; then
  echo "Usage: media <screen> ..." >&2
  exit 2
fi
shift || true

case "$sub" in
  screen)
    exec msgcode media screen "$@"
    ;;
  *)
    echo "Unsupported media subcommand: $sub" >&2
    exit 2
    ;;
esac
