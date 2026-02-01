# msgcode Jobs 设计草案（v2.1）

## 一句话目标
让 msgcode 支持“到点自动推进工作”的定时/周期任务：**写入 tmux（驱动 agent）→ 可选回发到 iMessage 群**，并且全程 **JSON-first、可诊断、可恢复**。

## 定位与边界

### 做什么
- 在 Gateway/daemon 进程里内置一个 **轻量调度器**，对本机 jobs 持久化管理。
- Job 到期时执行：
  1) 找到绑定群（RouteStore）对应的 workspace/tmux 会话
  2) 向 tmux 会话发送一条消息（像用户在群里发了一句一样）
  3) 读取响应（复用现有 reader/streamer 能力）
  4) 按策略回发到该群（或静默不回）
- 产生可机器读取的状态：job 列表、下次唤醒、运行历史、错误码。
- 可恢复：job 状态与调度元数据落盘；daemon 重启后自动恢复调度（重算 nextRunAt/nextWakeAt）。

### 不做什么（2.1 明确不做）
- 不执行任意 shell 命令（除非未来做 allowlist + workspace 内脚本白名单）。
- 不做跨机器/多机同步。
- 不做复杂 RBAC；2.1 仅提供“本机 owner 控制”（CLI 操作即 owner）。

## 核心原则（从优秀作品里学到的）
1) **Job 是数据，不是脚本**：可持久化、可审计、可迁移。
2) **调度器极简但硬**：一个 timer + nextWakeAt + 防卡死。
3) **执行语义分层**：主会话注入 vs 隔离执行；回传/投递是可选项且 best-effort。

---

## 文件与路径（建议）

### 默认路径（与现有 configDir 并列）
- Job Store：`~/.config/msgcode/cron/jobs.json`
- Run Log（追加写）：`~/.config/msgcode/cron/runs.jsonl`

### 原子写策略
- `jobs.json`：写入临时文件再 `rename`（原子替换）。
- `runs.jsonl`：追加写（每行一个 JSON），失败不应影响主链路。

---

## 数据模型（v1）

### CronStoreFile
```jsonc
{
  "version": 1,
  "jobs": [ /* CronJob[] */ ]
}
```

### CronJob
```jsonc
{
  "id": "uuid",
  "enabled": true,
  "name": "morning-brief",
  "description": "optional",

  /* 路由：永远对齐 RouteStore 的 chatGuid（单一真相源） */
  "route": {
    "chatGuid": "any;+;e110497bfed546efadff305352f7aec2"
  },

  /* 何时运行 */
  "schedule": { "kind": "cron", "expr": "0 7 * * *", "tz": "Asia/Shanghai" },

  /* 在哪运行 */
  "sessionTarget": "main",

  /* 做什么：2.1 仅允许“向 tmux 送消息” */
  "payload": { "kind": "tmuxMessage", "text": "生成今天简报：..." },

  /* 回发策略（iMessage only） */
  "delivery": {
    "mode": "reply-to-same-chat",
    "bestEffort": true,
    "maxChars": 2000
  },

  /* 运行状态（可诊断、可恢复） */
  "state": {
    "routeStatus": "valid",
    "nextRunAtMs": 1738262400000,
    "runningAtMs": null,
    "lastRunAtMs": 1738262400000,
    "lastStatus": "ok",
    "lastErrorCode": null,
    "lastError": null,
    "lastDurationMs": 800
  },

  "createdAtMs": 1738262400000,
  "updatedAtMs": 1738262400000
}
```

### 类型约束（建议）
- `route.chatGuid`：必须存在于 `routes.json`，否则 `state.routeStatus="orphaned"`，默认不自动运行（除非 `--force`）。
- `payload.text`：非空、trim 后长度 > 0。
- `name`：trim 后非空，建议限制 1~64 字符，作为 UI/日志可读名。

### 枚举定义（即使 2.1 只有一种值，也先把协议立住）
#### payload.kind
- `tmuxMessage`（2.1 唯一允许值）

#### state.routeStatus
- `valid`：routes.json 存在该 chatGuid 且 status=active
- `invalid`：routes.json 存在该 chatGuid，但绑定不完整/状态非 active（例如 paused/archived）
- `orphaned`：routes.json 不存在该 chatGuid（路由失效）

#### state.lastStatus
- `pending`：job 创建后尚未运行（或运行历史被清理）
- `ok`：本次运行成功
- `skipped`：符合“不可运行条件”而跳过（例如 empty payload、scheduler disabled）
- `error`：运行失败

---

## Schedule（时间语义）

支持三种 schedule（与优秀实践一致）：

### 1) at（一次性）
```jsonc
{ "kind": "at", "atMs": 1738262400000 }
```

语义：
- 到点后变为 due，**成功运行一次**后默认禁用（或可选 deleteAfterRun）。

### 2) every（固定间隔）
```jsonc
{ "kind": "every", "everyMs": 3600000, "anchorMs": 1738262400000 }
```

语义：
- `anchorMs` 作为对齐锚点，避免漂移。

### 3) cron（表达式 + 时区）
```jsonc
{ "kind": "cron", "expr": "0 7 * * *", "tz": "Asia/Shanghai" }
```

语义：
- 使用 `croner`（或同类库）计算 `nextRunAtMs`。
- **`tz` 必填**：必须使用 IANA 时区标识（如 `Asia/Shanghai`、`America/New_York`）。
- **禁止静默 fallback**：不允许使用系统时区作为默认值，避免系统时区变化导致 schedule 漂移。
- **时区变化处理**：daemon 启动时与每次 tick 前都重算 `nextRunAtMs`（对 `cron`/`every`），避免系统时区改变后 schedule 漂移。

---

## 执行语义（sessionTarget）

### A) main（推荐默认）
目的：用“主会话上下文”做定时推进（像人每天早上敲一句）。

实现建议：
- 复用该 chat 绑定的 workspace 与 tmux session（`stableGroupNameForChatId(chatGuid)`）。
- 调用现有 `handleTmuxSend(...)` 完成“送入 + 读出”。

### B) isolated（2.1 可选但建议设计进协议）
目的：后台任务不污染主会话历史；跑完只回传摘要/结果。

实现建议：
- 临时 tmux session：`job:<jobId>`（或 `cron:<jobId>`）。
- 执行完成后：按策略销毁该 session，避免长驻资源占用。
- 回传策略：
  - `reply-to-same-chat`：把最终输出（可截断）发回群里
  - `none`：只写 runs log，不回发

---

## 调度器（daemon 内部实现建议）

### 核心状态
- 内存中持有：store（jobs[]）+ 单个 timer
- 每次 store 变更后：
  1) 重算每个 job 的 `nextRunAtMs`
  2) 计算 `nextWakeAtMs = min(nextRunAtMs)`
  3) armTimer(nextWakeAtMs)

### 单 timer 约束（避免多个 setInterval 失控）
- 始终只保留 1 个 `setTimeout`
- 使用 `unref()`（允许进程正常退出/重启策略由 launchd 决定）
- 对超远 future 的 delay 做 clamp（避免 TimeoutOverflow）

### 防卡死（stuck 清理）
- 若 `runningAtMs` 超过阈值（默认建议 2h，但必须可配置）：
  - 清掉 running 标记
  - 写入 runs.jsonl：`status="error", error="stuck cleared"`
  - 继续调度其他 job（不让一个 job 挂死整个 scheduler）

配置建议（优先全局，后续可 per-job）：
- `CRON_STUCK_RUN_MS`（全局，默认 `2h`）
- 未来可加：`job.maxRunMs`（per-job 覆盖）

---

## Run Log（runs.jsonl）

每次运行追加一行：
```jsonc
{
  "ts": "2026-01-31T12:00:00.000Z",
  "jobId": "uuid",
  "chatGuid": "any;+;...",
  "sessionTarget": "main",
  "status": "ok",
  "durationMs": 800,
  "error": null,
  "textDigest": "sha256:abcd1234" /* 可选：只存摘要，不存正文 */
}
```

隐私原则：
- 默认不落用户/模型正文；只落 `textLength/textDigest`（与 E17 一致）。

### 保留策略（避免无限增长）
建议至少支持一种：
- `CRON_RUNS_RETENTION_DAYS`（默认 30 天）
- 或 `CRON_RUNS_MAX_LINES`（默认 10_000 行）

实现策略：
- 追加写不影响主链路；清理作为后台 best-effort（可在 daemon 启动/每日定时执行）。

---

## CLI 设计（v2.1）

> 2.1 优先 CLI（owner-only），群内命令后置。

### 命令面（建议）
- `msgcode job status --json`
- `msgcode job list --json [--all]`
- `msgcode job add --json <file>`（或 `--name/--at/--cron/...` 逐步补）
- `msgcode job edit <id> --json <patchFile>`
- `msgcode job edit <id> --patch '<json>'`（内联 patch，便于交互）
- `msgcode job enable <id>` / `msgcode job disable <id>`
- `msgcode job remove <id>`
- `msgcode job run <id> [--force]`
- `msgcode job runs [--id <id>] --json`
- `msgcode job validate [--id <id>] --json`（校验 routes/schedule/payload）

### dry-run（强烈建议）
对 `add/edit/run`：
- 支持 `--dry-run`：输出“将要写入/将要执行”的摘要，不产生副作用。

### status JSON（建议）
```jsonc
{
  "version": 1,
  "enabled": true,
  "storePath": "~/.config/msgcode/cron/jobs.json",
  "jobs": 3,
  "running": 0,
  "nextWakeAtMs": 1738262400000,
  "warnings": [],
  "errors": []
}
```

---

## 与现有系统的集成点（msgcode 侧）

### 依赖
- RouteStore：`~/.config/msgcode/routes.json`
- iMessage：`imsg rpc send`（用于回发）
- tmux：现有 session/sender/streamer（用于驱动 agent）

### 与 probe/doctor 的关系
把 job scheduler 作为 probe 类别之一（JSON-first）：
- store 可读/可解析
- jobs 数量、enabled 数量
- nextWakeAt 是否存在
- 是否存在 stuck/running 超时的 job

---

## 运行态错误码（2.1 建议）

> 规则：`lastErrorCode` 必须是稳定枚举；`lastError` 允许为简短人类文本（不含正文）。

- `ROUTE_NOT_FOUND`：routes.json 无该 chatGuid（orphaned）
- `ROUTE_INACTIVE`：路由存在但非 active（paused/archived）
- `SCHEDULE_INVALID`：schedule 无法解析（cron expr/tz 无效）
- `PAYLOAD_EMPTY`：payload 文本为空
- `TMUX_MISSING`：本机无 tmux
- `TMUX_SESSION_START_FAILED`：main session 不存在且尝试 start 失败
- `TMUX_SESSION_DEAD`：session 存在但不可用（send/capture 失败）
- `IMSG_SEND_FAILED`：回发失败（若 bestEffort=false 则计为 error）
- `DELIVERY_TRUNCATED`：输出被截断（不是错误，建议作为 warning 或 runLog 字段）
- `JOB_STUCK_CLEARED`：发现卡死标记并清理

---

## 启动恢复与并发控制（必须明确）

### daemon 启动时的恢复流程
1) 加载 `jobs.json`（坏 JSON → 报 `DATA_CRON_INVALID_JSON`，并进入 degraded 模式）
2) 对每个 job：
   - 重算 `state.routeStatus`
   - 重算 `state.nextRunAtMs`
3) 清理“孤儿 running”：
   - 若 `runningAtMs` 存在且超过 `CRON_STUCK_RUN_MS`：清理并写 runLog（`JOB_STUCK_CLEARED`）
   - 若 `runningAtMs` 存在但未超时：也应清理（daemon 重启意味着之前那次运行已丢失），并写 runLog（`error`，errorCode 可用 `JOB_ABORTED_BY_RESTART`）
4) armTimer(nextWakeAtMs)

### 并发约束
- 同一时刻最多执行 1 个 job（全局串行），避免 tmux/iMessage 互相干扰。
- 未来扩展：允许并行，但必须按 chatGuid 做串行队列（同群严格顺序）。

---

## tmux 与 delivery 的工程细节（2.1 建议写清）

### main session 健康检查与恢复
建议策略：
1) 发现 session 不存在：先尝试 `TmuxSession.start(...)`（best-effort resume）
2) 若仍失败：本次 job 记 `TMUX_SESSION_START_FAILED`，下次按 schedule 重试

### iMessage 回发截断策略
- 默认 `delivery.maxChars=2000`
- 超长时：
  - 只发前 `maxChars` 字符 + `…(truncated)`
  - 额外在 runLog 写 `fullTextDigest/fullTextLength`（仍不落正文）

---

## 待办 / 未来扩展（明确不在 2.1 做）
- 跨机器同步（多 Mac）
- RBAC（多用户/多角色）
- 任意 shell 执行（allowlist + workspace 脚本）
- WebUI（job 可视化/编辑）
---

## 验收清单（2.1）

### 最小闭环（必须）
1) `msgcode job add` 能写入 `jobs.json`
2) daemon 启动后能按 `at` schedule 触发一次
3) 能向目标群绑定的 tmux session 发送消息，并得到输出
4) `runs.jsonl` 有记录；`msgcode job status --json` 可读

### 稳定性（必须）
1) 重启 daemon 不丢 schedule（从 jobs.json 恢复）
2) timer 不会因为远未来 schedule 溢出
3) 单个 job 卡死不会拖垮整个 scheduler

### 隐私（必须）
1) runs/log 不落正文（默认）
