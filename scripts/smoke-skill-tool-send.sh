#!/usr/bin/env bash
set -euo pipefail

# ============================================
# Smoke: 模型是否按 Skill 指引调用工具并发送文件
# 默认群: game01 (any;+;2c34ffcbd27f4def9a422289404ab12c)
# ============================================

CHAT_GUID="any;+;2c34ffcbd27f4def9a422289404ab12c"
TIMEOUT_SEC=180
AUTO_SEND=0
LOG_FILE="${HOME}/.config/msgcode/log/msgcode.log"
IMSG_BIN="/Users/admin/GitProjects/msgcode/vendor/imsg/v0.4.0/imsg"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --chat-guid)
      CHAT_GUID="${2:-}"
      shift 2
      ;;
    --timeout)
      TIMEOUT_SEC="${2:-180}"
      shift 2
      ;;
    --auto-send)
      AUTO_SEND=1
      shift
      ;;
    *)
      echo "未知参数: $1"
      echo "用法: $0 [--chat-guid <guid>] [--timeout <sec>] [--auto-send]"
      exit 2
      ;;
  esac
done

if [[ ! -f "${LOG_FILE}" ]]; then
  echo "日志不存在: ${LOG_FILE}"
  exit 1
fi

if [[ ! -x "${IMSG_BIN}" ]]; then
  echo "imsg 不可执行: ${IMSG_BIN}"
  exit 1
fi

CHAT_SHORT="$(echo "${CHAT_GUID}" | awk -F';' '{print $NF}' | tail -c 7)"
TOKEN="SMOKE-SKILL-$(date +%s)"
STAMP_FILE="/tmp/msgcode-skill-smoke-${TOKEN}.txt"
START_TS="$(date '+%Y-%m-%d %H:%M:%S')"
START_EPOCH="$(date +%s)"

echo "${TOKEN}" > "${STAMP_FILE}"

PROMPT="【${TOKEN}】严格按步骤执行: 1) 使用read_file读取 /Users/admin/GitProjects/msgcode/AIDOCS/skills/imessage/SKILL.md 2) 使用read_file读取 /Users/admin/GitProjects/msgcode/AIDOCS/skills/file/SKILL.md 3) 使用bash执行: msgcode file send --path ${STAMP_FILE} --to ${CHAT_GUID} --caption ${TOKEN} --json 4) 最后只返回第3步JSON原文。"

echo "========================================"
echo "Smoke Token: ${TOKEN}"
echo "Chat Guid:   ${CHAT_GUID}"
echo "Chat Short:  ${CHAT_SHORT}"
echo "Temp File:   ${STAMP_FILE}"
echo "Start Time:  ${START_TS}"
echo "========================================"
echo
echo "请在目标群发送以下指令（可直接复制）："
echo "${PROMPT}"
echo

if [[ "${AUTO_SEND}" -eq 1 ]]; then
  echo "自动发送测试指令到目标群..."
  "${IMSG_BIN}" send --chat-guid "${CHAT_GUID}" --text "${PROMPT}" --json >/tmp/${TOKEN}-send.json || true
  echo "自动发送结果: /tmp/${TOKEN}-send.json"
  echo
fi

echo "开始轮询日志，最长 ${TIMEOUT_SEC}s..."
echo

SEEN_INBOUND=0
SEEN_TOOL=0
SEEN_BASH=0
SEEN_READ_FILE=0
SEEN_RESPONSE=0
LATEST_HIT="/tmp/${TOKEN}-hits.log"
: > "${LATEST_HIT}"

while true; do
  NOW_EPOCH="$(date +%s)"
  ELAPSED=$((NOW_EPOCH - START_EPOCH))

  strings -a "${LOG_FILE}" \
    | awk -v s="${START_TS}" '$0 >= s' \
    | rg "chatId=${CHAT_SHORT}|toolCallCount|toolName|responseText|SMOKE-SKILL" -S \
    > "${LATEST_HIT}" || true

  if rg -q "收到消息 .*chatId=${CHAT_SHORT}" -S "${LATEST_HIT}"; then
    SEEN_INBOUND=1
  fi
  if rg -q "toolCallCount=[1-9]" -S "${LATEST_HIT}"; then
    SEEN_TOOL=1
  fi
  if rg -q "toolName=bash" -S "${LATEST_HIT}"; then
    SEEN_BASH=1
  fi
  if rg -q "toolName=read_file" -S "${LATEST_HIT}"; then
    SEEN_READ_FILE=1
  fi
  if rg -q "responseText=" -S "${LATEST_HIT}"; then
    SEEN_RESPONSE=1
  fi

  if [[ "${SEEN_INBOUND}" -eq 1 && "${SEEN_TOOL}" -eq 1 && "${SEEN_BASH}" -eq 1 ]]; then
    break
  fi

  if [[ "${ELAPSED}" -ge "${TIMEOUT_SEC}" ]]; then
    break
  fi

  sleep 3
done

echo "========================================"
echo "检查结果"
echo "inbound:     ${SEEN_INBOUND}"
echo "tool_used:   ${SEEN_TOOL}"
echo "tool_bash:   ${SEEN_BASH}"
echo "tool_read:   ${SEEN_READ_FILE}"
echo "has_reply:   ${SEEN_RESPONSE}"
echo "evidence:    ${LATEST_HIT}"
echo "========================================"
echo

echo "关键日志片段："
tail -n 40 "${LATEST_HIT}" || true
echo

if [[ "${SEEN_INBOUND}" -eq 1 && "${SEEN_TOOL}" -eq 1 && "${SEEN_BASH}" -eq 1 ]]; then
  echo "PASS: 模型已触发工具链（含 bash）。"
  echo "请人工确认目标群是否收到文件: $(basename "${STAMP_FILE}")"
  exit 0
fi

echo "FAIL: 未观察到完整工具链。"
echo "建议先看: ${LATEST_HIT}"
exit 1

