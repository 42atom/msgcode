#!/usr/bin/env bash
set -euo pipefail

sub="${1:-}"
if [[ -z "$sub" ]]; then
  echo "Usage: file <find|read|write|delete|move|copy|send> ..." >&2
  exit 2
fi
shift || true

case "$sub" in
  find|read|write|delete|move|copy|send)
    exec msgcode file "$sub" "$@"
    ;;
  *)
    echo "Unsupported file subcommand: $sub" >&2
    exit 2
    ;;
esac
