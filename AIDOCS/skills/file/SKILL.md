---
name: file
description: 安全、有界的本地文件操作。触发时机：文件搜索/读取/写入/移动/删除/复制/压缩。默认仅限 workspace 内，越界需 --force。
---

# 文件管理 (file)

## 触发时机

- 查找/搜索文件
- 读取/写入文件
- 移动/复制/删除/重命名文件
- 压缩目录

## 命令列表

| 命令 | 说明 |
|------|------|
| `msgcode file find --dir <dir> --name <pattern>` | 查找文件 |
| `msgcode file read --path <path> [--lines <range>] [--force]` | 读取文件 |
| `msgcode file write --path <path> --content <text> [--append] [--force]` | 写入文件 |
| `msgcode file move --from <src> --to <dest>` | 移动文件 |
| `msgcode file rename --path <path> --new-name <name>` | 重命名 |
| `msgcode file delete --path <path> [--force]` | 删除文件 |
| `msgcode file copy --from <src> --to <dest>` | 复制文件 |
| `msgcode file zip --dir <dir> --out <zip>` | 压缩目录 |

## 示例

```bash
# 搜索 TypeScript 测试文件
msgcode file find --dir ./src --name "*.test.ts"

# 读取文件前 50 行
msgcode file read --path ./src/index.ts --lines 1-50

# 写入文件
msgcode file write --path ./output.txt --content "Hello World"
```

## 安全边界

- 默认仅限 workspace 内
- 禁止：`/etc`, `/private`, `~/.ssh`, `~/.aws`, `~/.config`
- 越界需 `--force` 显式确认
