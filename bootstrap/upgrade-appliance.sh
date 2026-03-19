#!/bin/sh
set -eu

usage() {
  echo "Usage: sh bootstrap/upgrade-appliance.sh --bundle-root <path> --install-root <path>" >&2
}

BUNDLE_ROOT=""
INSTALL_ROOT=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bundle-root)
      BUNDLE_ROOT="$2"
      shift 2
      ;;
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

if [ -z "$BUNDLE_ROOT" ] || [ -z "$INSTALL_ROOT" ]; then
  usage
  exit 2
fi

BUNDLE_ROOT=$(cd "$BUNDLE_ROOT" && pwd)
INSTALL_ROOT=$(cd "$INSTALL_ROOT" && pwd)

MANIFEST_PATH="$BUNDLE_ROOT/appliance.manifest"
RUNTIME_DIR="runtime"
LAUNCHER_REL="bin/msgcode"
RUNTIME_BIN_REL="$RUNTIME_DIR/bin/msgcode"
NODE_BIN_REL="$RUNTIME_DIR/node/bin"

if [ -f "$MANIFEST_PATH" ]; then
  . "$MANIFEST_PATH"
  RUNTIME_DIR="${MSGCODE_APPLIANCE_RUNTIME_DIR:-$RUNTIME_DIR}"
  LAUNCHER_REL="${MSGCODE_APPLIANCE_LAUNCHER_REL:-$LAUNCHER_REL}"
  RUNTIME_BIN_REL="${MSGCODE_APPLIANCE_RUNTIME_BIN_REL:-$RUNTIME_BIN_REL}"
  NODE_BIN_REL="${MSGCODE_APPLIANCE_NODE_BIN_REL:-$NODE_BIN_REL}"
fi

RUNTIME_SRC="$BUNDLE_ROOT/$RUNTIME_DIR"
RUNTIME_DST="$INSTALL_ROOT/$RUNTIME_DIR"
BIN_DIR="$INSTALL_ROOT/$(dirname "$LAUNCHER_REL")"
LAUNCHER_PATH="$INSTALL_ROOT/$LAUNCHER_REL"
TMP_RUNTIME="$INSTALL_ROOT/$RUNTIME_DIR.next"
PREV_RUNTIME="$INSTALL_ROOT/$RUNTIME_DIR.prev"

if [ ! -d "$RUNTIME_SRC" ]; then
  echo "Missing runtime bundle: $RUNTIME_SRC" >&2
  exit 2
fi

if [ ! -d "$RUNTIME_DST" ]; then
  echo "Missing installed runtime: $RUNTIME_DST" >&2
  echo "Run install-appliance.sh first." >&2
  exit 2
fi

rm -rf "$TMP_RUNTIME" "$PREV_RUNTIME"
cp -R "$RUNTIME_SRC" "$TMP_RUNTIME"
mv "$RUNTIME_DST" "$PREV_RUNTIME"
mv "$TMP_RUNTIME" "$RUNTIME_DST"

mkdir -p "$BIN_DIR"
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
rm -rf "$PREV_RUNTIME"

echo "Appliance 升级完成：$INSTALL_ROOT"
