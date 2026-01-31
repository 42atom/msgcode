# msgcode CLI Contract（v2.1 草案）

> 目的：把 CLI 当成“稳定 API”。默认面向机器消费（JSON-first），人类只是在查看 JSON 的一种视图。

## 0. 适用范围
- 本契约约束 `msgcode` CLI 的输出格式、退出码、错误码、隐私与副作用规范。
- 不约束内部实现细节（TypeScript/模块组织可演进）。

---

## 1) JSON 优先：输出 Envelope（强制）

### 1.1 统一输出结构
所有支持 `--json` 的命令必须输出以下 envelope（字段可增不可删；新增字段必须向后兼容）：

```jsonc
{
  "schemaVersion": 2,
  "requestId": "uuid-v4",
  "command": "msgcode <...>",
  "timestamp": "2026-01-31T00:00:00.000Z",
  "durationMs": 123,
  "status": "pass",          // pass | warning | error
  "exitCode": 0,
  "summary": {
    "warnings": 0,
    "errors": 0
  },
  "data": null,              // 命令业务数据（每个命令自定义 schema；无数据时为 null）
  "warnings": [],            // Diagnostic[]
  "errors": []               // Diagnostic[]
}
```

约束：
- `schemaVersion`：用于协议演进（与产品版本无关）。
- `requestId`：单次调用追踪 ID（CLI 与 daemon 交互时必须透传并回显）。
- `durationMs`：本次命令总耗时（便于性能诊断与超时定位）。

### 1.3 流式输出例外（有限允许）
仅下列命令允许“持续流式输出”，不强制逐行套 envelope：
- `msgcode logs -f`（或等价 tail/follow 命令）

建议做法：
- 启动时先输出 1 个 envelope header（`data.stream=true`）
- 结束时输出 1 个 envelope trailer（包含最终 `status/exitCode/durationMs`）

### 1.2 Diagnostic 结构（warnings/errors）
```jsonc
{
  "code": "CONFIG_MISSING_IMSG_PATH",
  "message": "IMSG_PATH 未配置或不可执行",
  "hint": "在 ~/.config/msgcode/.env 设置 IMSG_PATH=/path/to/imsg，并确保可执行权限",
  "details": { "path": "/Users/you/.../imsg" }
}
```

约束：
- `code`：稳定枚举（见第 4 节）。
- `message`：面向人类的短句（不可包含用户消息正文）。
- `hint`：可执行修复建议（尽量给命令行/系统设置路径）。
- `details`：机器可用细节（严禁落用户正文/模型回复正文）。

---

## 2) 退出码（强制）

### 2.1 通用退出码
- `0`：pass（成功且无警告）
- `2`：warning（成功但存在可操作风险/缺失能力）
- `1`：error（运行时失败；不可继续）
- `3`：usage_error（参数错误/命令不存在）
- `128+N`：signal death（POSIX：被信号 N 终止，例如 SIGTERM=15 → 143）

备注：
- `--json` 输出时也必须设置正确退出码（便于脚本/agent分支）。
- 仅“纯信息型命令”可允许恒为 0（例如 `msgcode version`），但仍需写明。

---

## 3) 副作用与安全（强制）

### 3.1 副作用分级
每个命令必须标注副作用级别（用于文档与 help）：
- `read-only`：只读（不写文件/不发消息/不改 tmux）
- `local-write`：写本地文件（routes/state/cron/jobs/log 等）
- `message-send`：发送 iMessage（imsg rpc send）
- `process-control`：进程控制（必须细分子类型）

建议细分（用于 `data.sideEffects` 与文档）：
- `process-control/daemon-lifecycle`：启动/停止/重启 daemon
- `process-control/tmux-session`：tmux 会话创建/销毁/切换/发送

### 3.2 dry-run / confirm
- 对 `local-write`/`message-send`/`process-control` 的命令：
  - 尽量提供 `--dry-run`（返回计划写入/发送的摘要，不执行）
  - 或提供 `--yes/--confirm`（默认要求交互确认，CI 可显式跳过）

dry-run 输出约定（仍输出 envelope）：
```jsonc
{
  "schemaVersion": 2,
  "requestId": "uuid-v4",
  "status": "pass",
  "data": {
    "dryRun": true,
    "planned": {
      "writes": ["~/.config/msgcode/cron/jobs.json"],
      "sends": []
    }
  }
}
```

### 3.3 隐私基线（默认不落正文）
CLI 输出与日志中：
- 默认只允许记录 `textLength` + `textDigest`（sha256 截断）
- 任何 `textPreview` 必须由显式开关打开（例如 `DEBUG_TRACE_TEXT=1`）
- 严禁：用户消息正文、模型回复正文、附件文件内容落盘（除非用户显式开启并写明风险）

落盘数据同样遵循该原则：
- `~/.config/msgcode/cron/runs.jsonl`（2.1 jobs 运行日志）
- `~/.config/msgcode/log/msgcode.log`

---

## 4) 错误码（v2.1 最小集合）

> 规则：错误码用于机器分支；“能自动修复的就给 hint；不能修复的就给证据点”。

### 4.1 CONFIG（配置类）
- `CONFIG_ENV_MISSING`：未找到 `~/.config/msgcode/.env`
- `CONFIG_MISSING_IMSG_PATH`：缺失 IMSG_PATH
- `CONFIG_IMSG_NOT_EXECUTABLE`：IMSG_PATH 不可执行
- `CONFIG_WORKSPACE_ROOT_INVALID`：WORKSPACE_ROOT 不存在或不可访问
- `CONFIG_WHITELIST_EMPTY`：白名单为空（风险）

### 4.2 PERMISSION（权限类）
- `PERM_FULL_DISK_ACCESS_MISSING`：Full Disk Access 缺失（无法读 Messages）
- `PERM_MESSAGES_NOT_READABLE`：chat.db 不可读（或 imsg 读失败）

### 4.3 DEPENDENCY（依赖类）
- `DEP_TMUX_MISSING`：tmux 不存在
- `DEP_CLAUDE_MISSING`：claude 不存在（当选择 claude client 时）
- `DEP_CODEX_MISSING`：codex 不存在（当选择 codex client 时）
- `DEP_OPENCODE_MISSING`：opencode 不存在（当选择 opencode client 时）

### 4.4 RUNTIME（运行态）
- `RUNTIME_DAEMON_NOT_RUNNING`：daemon 未运行
- `RUNTIME_IMSG_RPC_UNAVAILABLE`：imsg rpc 不可用/连接失败
- `RUNTIME_TMUX_SESSION_FAILED`：tmux 会话不可用

### 4.5 DATA（数据文件）
- `DATA_ROUTES_INVALID_JSON`：routes.json 解析失败
- `DATA_STATE_INVALID_JSON`：state.json 解析失败
- `DATA_CRON_INVALID_JSON`：cron/jobs.json 解析失败（2.1）

### 4.6 JOB（2.1 新增）
- `JOB_NOT_FOUND`：job ID 不存在
- `JOB_INVALID_SCHEDULE`：schedule 表达式非法（cron 语法/时区错误）
- `JOB_ROUTE_ORPHANED`：route.chatGuid 在 routes.json 中不存在
- `JOB_STUCK`：job 执行超时（防卡死阈值触发）

### 4.7 RATE_LIMIT（预留）
- `RATE_LIMIT_EXCEEDED`：触发限流（未来扩展；用于防刷屏/防风暴）

### 4.8 RUNTIME（补充）
- `RUNTIME_SCHEDULER_STUCK`：调度器卡死/无法推进（理论上应自愈，但需可观测）

### 4.9 MEMORY（2.1 新增）
- `MEMORY_WORKSPACE_NOT_FOUND`：workspaceId 不存在/无法解析
- `MEMORY_FILE_NOT_FOUND`：指定的 memory 文件不存在
- `MEMORY_INDEX_CORRUPTED`：index.sqlite 损坏，需 reindex
- `MEMORY_FTS_DISABLED`：FTS5 不可用
- `MEMORY_PATH_TRAVERSAL`：path 包含 `..` 或越界

---

## 5) 命令设计约定（v2.1）

### 5.1 命名与层级
- 顶层只放“用户心智上的大动作”：`start/stop/restart/doctor/status/logs/job/...`
- 细节用二级子命令承载：`msgcode job add|list|status|run|...`

### 5.2 JSON 输出开关
- 统一使用 `--json`（不再出现 `-j`/`--json` 多套并存）
- `--no-color` / `--quiet`（可选）为机器环境提供稳定输出

### 5.3 对齐 probe/doctor
- `doctor`：聚合检查（配置/权限/连接/路由/资源/cron/jobs），输出机器可解析诊断
- `probe`：可选保留为“单项检查入口”（例如 `probe permissions --json`）

### 5.4 通用查询参数（list 类命令）
为 list 类命令预留统一参数（实现可逐步补齐）：
- `--filter 'field==value'`：过滤条件（jq 风格；仅允许白名单字段）
- `--limit N`：最多返回 N 条（默认 50）
- `--offset N`：跳过前 N 条（与 --limit 组合）
- `--format json|yaml|table`：输出格式（未来扩展；2.1 默认仅 json）

---

## 6) 与 msgcode 2.0 现状的差距（需要收口）
## 6) 与 msgcode 2.0 现状的差距（收口清单）

### 6.1 需要统一的命令
- [ ] `status` vs `probe`：收口到单一实现（避免重复定义/行为漂移）
- [ ] `doctor`：新增并确保 `msgcode doctor --json` 输出 Envelope（含错误码与 fixHint）

### 6.2 需要补充的命令
- [ ] `msgcode job *` 子命令（见 `AIDOCS/msgcode-2.1/job_spec_v2.1.md:1`）
- [ ] `msgcode routes validate --json`

### 6.3 需要收口的输出
- [ ] 所有命令统一使用 Envelope（除 `logs -f` 流式例外）
- [ ] 所有错误码迁移到枚举（并落入 Diagnostic.code）

---

## 7) daemon 交互（requestId 透传）

CLI 调用 daemon（无论是 IPC/HTTP/stdio）时：
- CLI 生成 `requestId`
- daemon 必须在其输出 envelope 中 **原样回显 requestId**
- 任何内部子调用也应携带父 requestId（便于端到端追踪）

---

## 8) 国际化（预留）
- `code`：语言无关、稳定
- `message`/`hint`：可根据 `LANG` 环境变量切换（2.1 可先支持 `zh-CN`/`en`）
