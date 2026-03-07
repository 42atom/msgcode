#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: scheduler <add|list|remove> ..." >&2
  exit 1
fi

exec msgcode schedule "$@"
