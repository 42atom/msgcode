#!/bin/sh
set -eu

usage() {
  echo "Usage: sh bootstrap/first-run-init.sh --install-root <path> [--workspace <labelOrPath>]" >&2
}

INSTALL_ROOT=""
WORKSPACE=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-root)
      INSTALL_ROOT="$2"
      shift 2
      ;;
    --workspace)
      WORKSPACE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [ -z "$INSTALL_ROOT" ]; then
  usage
  exit 2
fi

INSTALL_ROOT=$(cd "$INSTALL_ROOT" && pwd)
LAUNCHER="$INSTALL_ROOT/bin/msgcode"

if [ ! -x "$LAUNCHER" ]; then
  echo "Missing appliance launcher: $LAUNCHER" >&2
  exit 2
fi

if [ -n "$WORKSPACE" ]; then
  exec "$LAUNCHER" init --workspace "$WORKSPACE"
fi

exec "$LAUNCHER" init
