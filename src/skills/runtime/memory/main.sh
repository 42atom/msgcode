#!/usr/bin/env bash
set -euo pipefail

sub="${1:-}"
if [[ -z "$sub" ]]; then
  echo "Usage: memory <add|search|stats|index|get|remember|status> ..." >&2
  exit 2
fi
shift || true

args=("$@")

inject_workspace=0
case "$sub" in
  add|search|index|get|remember)
    inject_workspace=1
    ;;
  stats|status)
    inject_workspace=0
    ;;
  *)
    echo "Unsupported memory subcommand: $sub" >&2
    exit 2
    ;;
esac

if [[ $inject_workspace -eq 1 ]]; then
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
fi

exec msgcode memory "$sub" "${args[@]}"
