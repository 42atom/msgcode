#!/usr/bin/env bash
set -euo pipefail

sub="${1:-}"
if [[ -z "$sub" ]]; then
  echo "Usage: feishu-send-file <current-chat-id> [--workspace <path>] [--json]" >&2
  exit 2
fi
shift || true

workspace="$PWD"
json=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace)
      workspace="${2:-}"
      shift 2
      ;;
    --json)
      json=1
      shift
      ;;
    *)
      echo "Unsupported argument: $1" >&2
      exit 2
      ;;
  esac
done

config_path="$workspace/.msgcode/config.json"

case "$sub" in
  current-chat-id)
    if [[ ! -f "$config_path" ]]; then
      if [[ $json -eq 1 ]]; then
        printf '{"ok":false,"error":"workspace config not found","configPath":"%s"}\n' "$config_path"
      else
        echo "workspace config not found: $config_path" >&2
      fi
      exit 1
    fi

    chat_id="$(
      node -e '
const fs = require("fs");
const path = process.argv[1];
const config = JSON.parse(fs.readFileSync(path, "utf8"));
const chatId = typeof config["runtime.current_chat_id"] === "string"
  ? config["runtime.current_chat_id"].trim()
  : "";
if (!chatId) process.exit(3);
process.stdout.write(chatId);
' "$config_path"
    )" || true

    if [[ -z "${chat_id:-}" ]]; then
      if [[ $json -eq 1 ]]; then
        printf '{"ok":false,"error":"runtime.current_chat_id not found","configPath":"%s"}\n' "$config_path"
      else
        echo "runtime.current_chat_id not found in: $config_path" >&2
      fi
      exit 1
    fi

    if [[ $json -eq 1 ]]; then
      printf '{"ok":true,"chatId":"%s","configPath":"%s"}\n' "$chat_id" "$config_path"
    else
      echo "$chat_id"
    fi
    ;;
  *)
    echo "Unsupported subcommand: $sub" >&2
    exit 2
    ;;
esac
