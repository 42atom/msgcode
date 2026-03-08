#!/usr/bin/env bash
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "Usage: scheduler <add|list|remove> ..." >&2
  exit 1
fi

command="$1"
shift

resolve_default_tz() {
  if [[ -n "${MSGCODE_SCHEDULER_DEFAULT_TZ:-}" ]]; then
    printf '%s\n' "${MSGCODE_SCHEDULER_DEFAULT_TZ}"
    return 0
  fi

  if [[ -n "${TZ:-}" && "${TZ}" == */* ]]; then
    printf '%s\n' "${TZ}"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    local detected
    detected="$(node -e 'const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; if (tz) process.stdout.write(tz);' 2>/dev/null || true)"
    if [[ -n "$detected" && "$detected" == */* ]]; then
      printf '%s\n' "$detected"
      return 0
    fi
  fi

  return 1
}

case "$command" in
  create)
    command="add"
    ;;
  rm|del|delete|stop)
    command="remove"
    ;;
  ls)
    command="list"
    ;;
esac

requires_schedule_id=false
has_tz=false
case "$command" in
  add|remove|enable|disable)
    requires_schedule_id=true
    ;;
esac

schedule_id=""
normalized_args=()

while (($# > 0)); do
  case "$1" in
    --scheduleId|--schedule-id|--id)
      shift
      if (($# == 0)); then
        echo "scheduler: missing value for scheduleId" >&2
        exit 1
      fi
      schedule_id="$1"
      ;;
    --workspace|--cron|--tz|--message|--max-chars)
      option_name="$1"
      shift
      if (($# == 0)); then
        echo "scheduler: missing value for $option_name" >&2
        exit 1
      fi
      if [[ "$option_name" == "--tz" ]]; then
        has_tz=true
      fi
      normalized_args+=("$option_name" "$1")
      ;;
    *)
      if [[ "$requires_schedule_id" == true && -z "$schedule_id" && "$1" != --* ]]; then
        schedule_id="$1"
      else
        normalized_args+=("$1")
      fi
      ;;
  esac
  shift
done

normalized_command=("$command")
if [[ -n "$schedule_id" ]]; then
  normalized_command+=("$schedule_id")
fi

if [[ "$command" == "add" && "$has_tz" == false ]]; then
  if default_tz="$(resolve_default_tz)"; then
    normalized_args+=("--tz" "$default_tz")
  fi
fi

normalized_command+=("${normalized_args[@]}")

if [[ "$requires_schedule_id" == true && -z "$schedule_id" ]]; then
  echo "scheduler: missing required positional argument <schedule-id>" >&2
  exit 1
fi

if [[ "${MSGCODE_SCHEDULER_DRY_RUN:-0}" == "1" ]]; then
  printf '%s\n' "${normalized_command[@]}"
  exit 0
fi

exec msgcode schedule "${normalized_command[@]}"
