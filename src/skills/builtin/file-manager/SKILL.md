---
name: file-manager
description: 安全、有界的本地文件操作能力。触发时机：用户需要搜索/读取/写入/移动/删除/复制/压缩文件时。默认仅限 workspace 内操作，越界需 --force 显式确认。
---

# 文件管理技能

## 触发时机

当用户请求涉及本地文件操作时触发：
- 查找/搜索文件
- 读取文件内容
- 写入/创建文件
- 移动/复制/删除/重命名文件
- 压缩目录

## 可用命令

### msgcode file find

查找文件。

```bash
msgcode file find --dir . --name "*.ts"
msgcode file find --dir ./src --name "*.test.ts"
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --dir | 否 | 搜索目录，默认 . |
| --name | 是 | 文件名模式（glob） |

### msgcode file read

读取文件内容。

```bash
msgcode file read --path ./src/index.ts
msgcode file read --path ./src/index.ts --lines 1-50
msgcode file read --path /tmp/data.txt --force
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --path | 是 | 文件路径 |
| --lines | 否 | 行范围，如 "1-50" |
| --force | 否 | 读取 workspace 外文件 |

### msgcode file write

写入文件内容。

```bash
msgcode file write --path ./output.txt --content "Hello"
msgcode file write --path ./log.txt --content "New line" --append
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --path | 是 | 文件路径 |
| --content | 是 | 文件内容 |
| --append | 否 | 追加模式 |
| --force | 否 | 写入 workspace 外文件 |

### msgcode file move

移动文件。

```bash
msgcode file move --from ./old.txt --to ./new.txt
```

| 参数 | 必填 | 说明 |
|------|------|------|
| --from | 是 | 源路径 |
| --to | 是 | 目标路径 |
| --force | 否 | 强制覆盖 |

### msgcode file rename

重命名文件。

```bash
msgcode file rename --path ./old.txt --new-name new.txt
```

### msgcode file delete

删除文件。

```bash
msgcode file delete --path ./temp.txt
msgcode file delete --path ./temp.txt --force
```

### msgcode file copy

复制文件。

```bash
msgcode file copy --from ./src.txt --to ./dest.txt
```

### msgcode file zip

压缩目录。

```bash
msgcode file zip --dir ./logs --out ./logs.zip
```

## 安全边界

- 默认仅限 workspace 内操作
- 以下路径禁止访问：`/etc`, `/private`, `~/.ssh`, `~/.aws`, `~/.config`
- 越界操作必须 `--force` 显式确认

## 错误码

- `0`: 成功
- `1`: 文件不存在/权限不足
- `2`: 越界操作（无 --force）
