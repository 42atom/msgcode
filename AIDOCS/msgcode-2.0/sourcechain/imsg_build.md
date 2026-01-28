# imsg 供应链构建文档

> 版本固定策略：源码构建 + hash 校验，脱离 brew release zip 依赖

## 仓库信息

| 字段 | 值 |
|------|-----|
| 仓库 | https://github.com/steipete/imsg |
| 许可证 | MIT |
| 当前版本 | v0.4.0 |
| 固定 commit | 7a93d64881bc6c97df6e1d097b4a129ff61da895 |
| 平台要求 | macOS 14+ |

## 快速开始

```bash
# 一键构建
./scripts/build-imsg.sh

# 校验产物
./scripts/verify-imsg.sh
```

## 构建流程详解

### 1. 环境要求

```bash
# 检查 Swift 工具链
swift --version        # >= 6.0
swift package --version

# 检查 Python（补丁脚本需要）
python3 --version

# 检查 codesign（系统自带）
codesign -h
```

### 2. 源码获取与 Pin

```bash
# 创建构建目录
BUILD_DIR=$(mktemp -d)
cd "$BUILD_DIR"

# Clone 仓库
git clone https://github.com/steipete/imsg.git
cd imsg

# Pin 到固定版本
git fetch --tags
git checkout v0.4.0
git checkout -b pinned-v0.4.0 7a93d64881bc6c97df6e1d097b4a129ff61da895

# 验证 commit
git rev-parse HEAD
# 期望输出: 7a93d64881bc6c97df6e1d097b4a129ff61da895
```

### 3. 构建

```bash
# 创建 version.env（upstream Makefile 需要）
cat > version.env <<EOF
MARKETING_VERSION=0.4.0
CURRENT_PROJECT_VERSION=1
EOF

# 执行构建
make build

# 产物位置
# ./bin/imsg (universal binary: arm64 + x86_64)
```

### 4. 产物安装

```bash
# 目标目录
MSGCODE_ROOT=<msgcode项目根目录>
VENDOR_DIR="$MSGCODE_ROOT/vendor/imsg/v0.4.0"
mkdir -p "$VENDOR_DIR"

# 复制二进制
cp ./bin/imsg "$VENDOR_DIR/imsg"

# 生成 hash 记录
shasum -a 256 "$VENDOR_DIR/imsg" > "$VENDOR_DIR/imsg.sha256"
cat "$VENDOR_DIR/imsg.sha256"
```

### 5. 配置 msgcode

```bash
# 在 .env 或 ~/.config/msgcode/.env 中添加
IMSG_PATH=$VENDOR_DIR/imsg
```

## 校验方法

### Hash 校验

```bash
VENDOR_DIR="$MSGCODE_ROOT/vendor/imsg/v0.4.0"

# 计算当前 hash
CURRENT_HASH=$(shasum -a 256 "$VENDOR_DIR/imsg" | cut -d' ' -f1)

# 对比记录
RECORDED_HASH=$(cat "$VENDOR_DIR/imsg.sha256" | cut -d' ' -f1)

if [ "$CURRENT_HASH" = "$RECORDED_HASH" ]; then
    echo "Hash 校验通过"
else
    echo "Hash 校验失败"
    exit 1
fi
```

### 功能校验

```bash
# 版本检查
$IMSG_PATH --version
# 期望输出: imsg 0.4.0

# RPC 帮助检查
$IMSG_PATH rpc --help
# 期望输出包含: watch, send, chats 等子命令

# 基本功能检查（需要 Full Disk Access）
$IMSG_PATH chats --limit 1 --json
# 期望输出: JSON 数组，包含 chat 信息
```

## 失败排查

### 构建失败

| 症状 | 可能原因 | 解决方案 |
|------|----------|----------|
| swift: command not found | Xcode Command Line Tools 未安装 | `xcode-select --install` |
| version.env not found | 未创建版本文件 | 手动创建 version.env |
| patch-deps.sh 失败 | Python 未安装或版本过旧 | `brew install python3` |
| codesign failed | 权限问题 | 使用 `CODESIGN_IDENTITY=-` 匿名签名 |

### 校验失败

| 症状 | 可能原因 | 解决方案 |
|------|----------|----------|
| Hash 不匹配 | 二进制被修改/损坏 | 重新构建 |
| imsg: command not found | IMSG_PATH 配置错误 | 检查 .env 中的路径 |
| --version 无输出 | 二进制损坏或架构不匹配 | 检查 `file $(which imsg)` |
| RPC 不可用 | 构建时缺少依赖 | 确保 `make build` 完整执行 |

## 构建脚本说明

### scripts/build-imsg.sh

自动化构建脚本，执行以下步骤：
1. 创建临时构建目录
2. Clone 并 checkout 到 pinned 版本
3. 生成 version.env
4. 执行 `make build`
5. 复制产物到 vendor/imsg/<version>/
6. 生成 .sha256 记录

### scripts/verify-imsg.sh

校验脚本，执行以下检查：
1. 产物存在性检查
2. Hash 校验
3. 版本号检查
4. RPC 命令可用性检查

## 版本升级流程

当需要升级到新版本时：

1. 更新本文档的仓库信息（版本号、commit）
2. 更新 scripts/build-imsg.sh 中的 VERSION 和 COMMIT
3. 运行构建脚本
4. 更新 .env 中的 IMSG_PATH 指向新版本
5. 保留旧版本作为回滚选项

## 回滚策略

```bash
# .env 中回滚到旧版本
IMSG_PATH=$MSGCODE_ROOT/vendor/imsg/v0.3.0/imsg

# 或回滚到 brew（验证用途）
# brew install imsg
# IMSG_PATH=$(brew --prefix imsg)/bin/imsg
```

## 参考链接

- imsg 仓库：https://github.com/steipete/imsg
- v0.4.0 Release：https://github.com/steipete/imsg/releases/tag/v0.4.0
- Commit 7a93d64：https://github.com/steipete/imsg/commit/7a93d64881bc6c97df6e1d097b4a129ff61da895
