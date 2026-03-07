#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "" ]]; then
  echo "Usage: pinchtab-browser <root|profiles|instances|tabs|snapshot|text|action|eval|gmail-readonly> ..." >&2
  exit 2
fi

exec msgcode browser "$@"
