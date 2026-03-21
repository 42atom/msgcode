#!/bin/sh
set -eu

DEFAULT_MANAGED_BASH_CANDIDATES="/opt/homebrew/bin/bash:/usr/local/bin/bash"
DEFAULT_ZSTD_CANDIDATES="/opt/homebrew/bin/zstd:/usr/local/bin/zstd:zstd"
PREINSTALL_REFERENCE_DOC="/Users/admin/GitProjects/msgcode/docs/plan/rf0002.rvw.product.appliance-required-preinstall-software.md"

find_first_executable() {
  candidates="$1"
  old_ifs=$IFS
  IFS=':'
  set -- $candidates
  IFS=$old_ifs

  for candidate in "$@"; do
    [ -n "$candidate" ] || continue
    case "$candidate" in
      */*)
        if [ -x "$candidate" ]; then
          printf '%s\n' "$candidate"
          return 0
        fi
        ;;
      *)
        resolved=$(command -v "$candidate" 2>/dev/null || true)
        if [ -n "$resolved" ] && [ -x "$resolved" ]; then
          printf '%s\n' "$resolved"
          return 0
        fi
        ;;
    esac
  done

  return 1
}

run_appliance_preinstall_checks() {
  mode="$1"
  failures=0

  managed_bash_candidates="${MSGCODE_MANAGED_BASH_CANDIDATES:-$DEFAULT_MANAGED_BASH_CANDIDATES}"
  managed_bash_path=$(find_first_executable "$managed_bash_candidates" || true)
  if [ -n "$managed_bash_path" ]; then
    echo "[preinstall] managed-bash: ok ($managed_bash_path)"
  else
    echo "Missing Core Appliance preinstall dependency: managed bash" >&2
    echo "Expected one of: $managed_bash_candidates" >&2
    failures=1
  fi

  zstd_candidates="${MSGCODE_ZSTD_CANDIDATES:-$DEFAULT_ZSTD_CANDIDATES}"
  zstd_path=$(find_first_executable "$zstd_candidates" || true)
  if [ -n "$zstd_path" ]; then
    echo "[preinstall] zstd: ok ($zstd_path)"
  else
    echo "Missing Core Appliance preinstall dependency: zstd" >&2
    echo "Expected one of: $zstd_candidates" >&2
    failures=1
  fi

  if [ "$failures" -ne 0 ]; then
    echo "$mode failed: missing required preinstall software. See: $PREINSTALL_REFERENCE_DOC" >&2
    return 1
  fi
}
