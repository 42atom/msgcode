#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

load_brew_env() {
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    return 0
  fi
  if [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
    return 0
  fi
  return 1
}

if ! need_cmd brew; then
  echo "Homebrew 缺失，请先安装 Homebrew：" >&2
  echo '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' >&2
  exit 2
fi

load_brew_env || true
brew bundle --file "$ROOT_DIR/Brewfile"
echo "默认层安装完成。继续执行：sh $ROOT_DIR/doctor-managed-bash.sh"
