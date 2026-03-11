#!/usr/bin/env bash
set -euo pipefail

sub="${1:-}"
if [[ -z "$sub" ]]; then
  echo "Usage: todo <add|list|done> ..." >&2
  exit 2
fi
shift || true

args=("$@")
has_workspace=0
for a in "${args[@]}"; do
  if [[ "$a" == "--workspace" ]]; then
    has_workspace=1
    break
  fi
done
if [[ $has_workspace -eq 0 ]]; then
  args+=(--workspace "$PWD")
fi

case "$sub" in
  add|list|done)
    exec msgcode todo "$sub" "${args[@]}"
    ;;
  *)
    echo "Unsupported todo subcommand: $sub" >&2
    exit 2
    ;;
esac
