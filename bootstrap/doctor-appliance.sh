#!/bin/sh
set -eu

usage() {
  echo "Usage: sh bootstrap/doctor-appliance.sh --install-root <path>" >&2
}

INSTALL_ROOT=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --install-root)
      INSTALL_ROOT="$2"
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
MANIFEST_PATH="$INSTALL_ROOT/appliance.manifest"
MANIFEST_VERSION=""
APP_VERSION=""
RUNTIME_DIR="runtime"
LAUNCHER_REL="bin/msgcode"
RUNTIME_BIN_REL="$RUNTIME_DIR/bin/msgcode"

if [ -f "$MANIFEST_PATH" ]; then
  . "$MANIFEST_PATH"
  MANIFEST_VERSION="${MSGCODE_APPLIANCE_MANIFEST_VERSION:-$MANIFEST_VERSION}"
  APP_VERSION="${MSGCODE_APPLIANCE_APP_VERSION:-$APP_VERSION}"
  RUNTIME_DIR="${MSGCODE_APPLIANCE_RUNTIME_DIR:-$RUNTIME_DIR}"
  LAUNCHER_REL="${MSGCODE_APPLIANCE_LAUNCHER_REL:-$LAUNCHER_REL}"
  RUNTIME_BIN_REL="${MSGCODE_APPLIANCE_RUNTIME_BIN_REL:-$RUNTIME_BIN_REL}"
fi

RUNTIME_ROOT="$INSTALL_ROOT/$RUNTIME_DIR"
LAUNCHER_PATH="$INSTALL_ROOT/$LAUNCHER_REL"
RUNTIME_BIN_PATH="$INSTALL_ROOT/$RUNTIME_BIN_REL"

if [ ! -f "$MANIFEST_PATH" ]; then
  echo "Missing installed manifest: $MANIFEST_PATH" >&2
  exit 2
fi

if [ -z "$MANIFEST_VERSION" ]; then
  echo "Missing manifest version in: $MANIFEST_PATH" >&2
  exit 2
fi

if [ "$MANIFEST_VERSION" != "1" ]; then
  echo "Unsupported manifest version: $MANIFEST_VERSION" >&2
  exit 2
fi

if [ -z "$APP_VERSION" ]; then
  echo "Missing appliance app version in: $MANIFEST_PATH" >&2
  exit 2
fi

if [ ! -d "$RUNTIME_ROOT" ]; then
  echo "Missing runtime dir: $RUNTIME_ROOT" >&2
  exit 2
fi

if [ ! -x "$LAUNCHER_PATH" ]; then
  echo "Missing launcher: $LAUNCHER_PATH" >&2
  exit 2
fi

if [ ! -x "$RUNTIME_BIN_PATH" ]; then
  echo "Missing runtime entry: $RUNTIME_BIN_PATH" >&2
  exit 2
fi

echo "Appliance doctor 通过：$INSTALL_ROOT (version=$APP_VERSION)"
