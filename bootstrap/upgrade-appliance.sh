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

RUNTIME_SRC="$BUNDLE_ROOT/runtime"
RUNTIME_DST="$INSTALL_ROOT/runtime"
BIN_DIR="$INSTALL_ROOT/bin"
LAUNCHER_PATH="$BIN_DIR/msgcode"
TMP_RUNTIME="$INSTALL_ROOT/runtime.next"
PREV_RUNTIME="$INSTALL_ROOT/runtime.prev"

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
cat > "$LAUNCHER_PATH" <<'EOF'
#!/bin/sh
set -eu
SELF_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
RUNTIME_ROOT=$(cd "$SELF_DIR/.." && pwd)/runtime
if [ -d "$RUNTIME_ROOT/node/bin" ]; then
  PATH="$RUNTIME_ROOT/node/bin:$PATH"
  export PATH
fi
export MSGCODE_RUNTIME_ROOT="$RUNTIME_ROOT"
exec "$RUNTIME_ROOT/bin/msgcode" "$@"
EOF

chmod +x "$LAUNCHER_PATH"
rm -rf "$PREV_RUNTIME"

echo "Appliance 升级完成：$INSTALL_ROOT"
