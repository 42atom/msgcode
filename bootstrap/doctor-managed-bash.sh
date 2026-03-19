#!/bin/sh
set -eu

if [ -x /opt/homebrew/bin/bash ]; then
  BASH_PATH=/opt/homebrew/bin/bash
elif [ -x /usr/local/bin/bash ]; then
  BASH_PATH=/usr/local/bin/bash
else
  echo "托管 Bash 缺失：只认 /opt/homebrew/bin/bash 或 /usr/local/bin/bash" >&2
  echo "安装：brew install bash" >&2
  exit 2
fi

echo "managed_bash=$BASH_PATH"
"$BASH_PATH" --version | head -n 1
