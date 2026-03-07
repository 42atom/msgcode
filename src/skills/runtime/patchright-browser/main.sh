#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: patchright-browser <root|profiles|instances|tabs|snapshot|text|action|eval|gmail-readonly> ..." >&2
  exit 1
fi

exec msgcode browser "$@"
