#!/usr/bin/env bash
set -euo pipefail

sub="${1:-}"
if [[ -z "$sub" ]]; then
  echo "Usage: thread <list|messages|active|switch> ..." >&2
  exit 2
fi
shift || true

case "$sub" in
  list|messages|active|switch)
    exec msgcode thread "$sub" "$@"
    ;;
  *)
    echo "Unsupported thread subcommand: $sub" >&2
    exit 2
    ;;
esac
