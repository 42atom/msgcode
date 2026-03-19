#!/bin/sh
set -eu

usage() {
  echo "Usage: sh bootstrap/rollback-appliance.sh --install-root <path>" >&2
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
INSTALLED_MANIFEST="$INSTALL_ROOT/appliance.manifest"
PREV_MANIFEST="$INSTALL_ROOT/appliance.manifest.prev"

RUNTIME_DIR="runtime"
LAUNCHER_REL="bin/msgcode"
RUNTIME_BIN_REL="$RUNTIME_DIR/bin/msgcode"
NODE_BIN_REL="$RUNTIME_DIR/node/bin"

if [ ! -f "$INSTALLED_MANIFEST" ]; then
  echo "Missing installed manifest: $INSTALLED_MANIFEST" >&2
  exit 2
fi

if [ ! -f "$PREV_MANIFEST" ]; then
  echo "Missing rollback manifest: $PREV_MANIFEST" >&2
  exit 2
fi

. "$INSTALLED_MANIFEST"
RUNTIME_DIR="${MSGCODE_APPLIANCE_RUNTIME_DIR:-$RUNTIME_DIR}"
LAUNCHER_REL="${MSGCODE_APPLIANCE_LAUNCHER_REL:-$LAUNCHER_REL}"
RUNTIME_BIN_REL="${MSGCODE_APPLIANCE_RUNTIME_BIN_REL:-$RUNTIME_BIN_REL}"
NODE_BIN_REL="${MSGCODE_APPLIANCE_NODE_BIN_REL:-$NODE_BIN_REL}"

CURRENT_LAUNCHER_PATH="$INSTALL_ROOT/$LAUNCHER_REL"
CURRENT_RUNTIME="$INSTALL_ROOT/$RUNTIME_DIR"
PREV_RUNTIME="$INSTALL_ROOT/$RUNTIME_DIR.prev"
TMP_RUNTIME="$INSTALL_ROOT/$RUNTIME_DIR.rollback"
TMP_MANIFEST="$INSTALL_ROOT/appliance.manifest.rollback"

if [ ! -d "$PREV_RUNTIME" ]; then
  echo "Missing rollback runtime: $PREV_RUNTIME" >&2
  exit 2
fi

mv "$CURRENT_RUNTIME" "$TMP_RUNTIME"
mv "$PREV_RUNTIME" "$CURRENT_RUNTIME"
mv "$TMP_RUNTIME" "$PREV_RUNTIME"

mv "$INSTALLED_MANIFEST" "$TMP_MANIFEST"
mv "$PREV_MANIFEST" "$INSTALLED_MANIFEST"
mv "$TMP_MANIFEST" "$PREV_MANIFEST"

RUNTIME_DIR="runtime"
LAUNCHER_REL="bin/msgcode"
RUNTIME_BIN_REL="$RUNTIME_DIR/bin/msgcode"
NODE_BIN_REL="$RUNTIME_DIR/node/bin"
. "$INSTALLED_MANIFEST"
RUNTIME_DIR="${MSGCODE_APPLIANCE_RUNTIME_DIR:-$RUNTIME_DIR}"
LAUNCHER_REL="${MSGCODE_APPLIANCE_LAUNCHER_REL:-$LAUNCHER_REL}"
RUNTIME_BIN_REL="${MSGCODE_APPLIANCE_RUNTIME_BIN_REL:-$RUNTIME_BIN_REL}"
NODE_BIN_REL="${MSGCODE_APPLIANCE_NODE_BIN_REL:-$NODE_BIN_REL}"

LAUNCHER_PATH="$INSTALL_ROOT/$LAUNCHER_REL"
if [ "$CURRENT_LAUNCHER_PATH" != "$LAUNCHER_PATH" ] && [ -e "$CURRENT_LAUNCHER_PATH" ]; then
  rm -f "$CURRENT_LAUNCHER_PATH"
fi

mkdir -p "$(dirname "$LAUNCHER_PATH")"
cat > "$LAUNCHER_PATH" <<EOF
#!/bin/sh
set -eu
SELF_DIR=\$(CDPATH= cd -- "\$(dirname "\$0")" && pwd)
INSTALL_ROOT=\$(cd "\$SELF_DIR/.." && pwd)
RUNTIME_ROOT="\$INSTALL_ROOT/$RUNTIME_DIR"
if [ -d "\$INSTALL_ROOT/$NODE_BIN_REL" ]; then
  PATH="\$INSTALL_ROOT/$NODE_BIN_REL:\$PATH"
  export PATH
fi
export MSGCODE_RUNTIME_ROOT="\$RUNTIME_ROOT"
exec "\$INSTALL_ROOT/$RUNTIME_BIN_REL" "\$@"
EOF

chmod +x "$LAUNCHER_PATH"

echo "Appliance 回滚完成：$INSTALL_ROOT"
