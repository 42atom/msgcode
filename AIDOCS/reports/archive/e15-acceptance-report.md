# E15 可观测性探针 v1 验收报告

## 实现概述

实现了 `msgcode status` 和 `msgcode probe` 两个新命令，提供系统健康检查功能。

## 改动文件列表

### 新增文件
- `src/probe/types.ts` - 探针类型定义
- `src/probe/executor.ts` - 命令执行器（可注入）
- `src/probe/probes.ts` - 7个探针实现
- `src/probe/index.ts` - 模块导出
- `src/cli/status.ts` - status 命令
- `src/cli/probe.ts` - probe 命令
- `test/probe.test.ts` - 单元测试（6个测试用例）

### 修改文件
- `src/cli.ts` - 添加 status 和 probe 子命令

## 功能验收

### 1. msgcode status 命令
```bash
$ msgcode status

msgcode 2.0 status

Whitelist:
  Emails: wan2011@me.com

Group Routes:
  default: any;+;e110497bfed546efadff305352f7aec2 -> /Users/admin/GitProjects

Default Group:
  default

Logging:
  Level: info
  File: /Users/admin/.config/msgcode/log/msgcode.log (exists)

Route Storage:
  Path: /Users/admin/.config/msgcode/routes.json (exists)

Workspace:
  Root: /Users/admin/msgcode-workspaces (not created)

Advanced:
  File Watcher: enabled
  Skip Unread Backlog: yes
```

### 2. msgcode probe 命令（纯文本模式）
```bash
$ msgcode probe

msgcode 2.0 probe

[FAIL] imsg executable: imsg not found or not executable
    Hint: Install imsg: ./scripts/build-imsg.sh or set IMSG_PATH in ~/.config/msgcode/.env
[FAIL] rpc help available: imsg rpc --help failed
    Hint: Update imsg to v0.4.0+ with rpc support
[OK] routes.json readable: /Users/admin/.config/msgcode/routes.json
[OK] routes.json valid JSON: valid JSON format
[OK] WORKSPACE_ROOT writable: /Users/admin/msgcode-workspaces (created)
[OK] tmux available: tmux 3.6a
[OK] claude available: 2.1.12 (Claude Code)

Summary: 5 OK, 2 FAIL
Exit code: 1
```

### 3. msgcode probe --json 命令
```bash
$ msgcode probe --json

msgcode 2.0 probe

{
  "results": [...],
  "summary": {
    "ok": 5,
    "fail": 2,
    "skip": 0
  },
  "allOk": false
}
```

## 单测结果

```bash
$ bun test test/probe.test.ts

bun test v1.3.4 (5eb2145b)

 6 pass
 0 fail
 27 expect() calls
Ran 6 tests across 1 file. [119.00ms]
```

测试覆盖：
- ✅ 所有探针通过时报告正确
- ✅ imsg 版本检查失败
- ✅ routes.json 无效 JSON
- ✅ routes.json 不存在时的处理
- ✅ tmux 不可用
- ✅ claude 不可用

## 完整测试套件

```bash
$ bun test

164 pass
0 fail
341 expect() calls
Ran 164 tests across 13 files. [930.00ms]
```

所有现有测试仍然通过，没有破坏现有功能。

## 探针覆盖

实现了以下 7 项探针：

1. ✅ imsg 二进制可执行性 + 版本检查
2. ✅ imsg rpc 命令可用性（watch/send/chats）
3. ✅ routes.json 可读性
4. ✅ routes.json 可解析性（JSON 格式）
5. ✅ WORKSPACE_ROOT 可写性
6. ✅ tmux 可用性
7. ✅ claude CLI 可用性

## 输出格式验收

- ✅ 纯文本输出，无 emoji
- ✅ 使用 `[OK]` / `[FAIL]` 前缀
- ✅ 失败时提供修复建议（fixHint）
- ✅ 失败时进程返回码 = 1
- ✅ JSON 格式输出正确

## 可注入 executor

- ✅ 定义了 `CommandExecutor` 接口
- ✅ 实现了 `RealCommandExecutor`（生产环境）
- ✅ 实现了 `MockCommandExecutor`（测试环境）
- ✅ 单元测试使用 mock executor，不真实运行 tmux/claude

## 设计亮点

1. **探针优先尝试执行命令**：对 mock executor 更友好，先尝试运行命令，失败后再检查文件系统
2. **文件不存在时的优雅处理**：routes.json 不存在时标记为 OK（属于 SKIP），不算失败
3. **可测试性**：通过接口注入，单元测试完全隔离，不依赖外部命令
4. **返回码语义**：全部 OK 返回 0，有 FAIL 返回 1，便于 CI/CD 集成

## 后续优化空间

1. 添加更多探针（如磁盘空间、内存使用等）
2. 支持并行运行探针提升性能
3. 添加历史记录和趋势分析
4. 支持 webhook 通知（告警）
5. 添加自愈功能（自动修复简单问题）

## 结论

✅ E15 可观测性探针 v1 实现完成，所有验收标准达成。
