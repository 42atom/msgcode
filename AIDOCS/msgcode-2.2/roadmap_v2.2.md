# msgcode 2.2 路线图（控盘版）

> 目标：把 msgcode 从“能跑”升级为“可交付的本地 Agent 平台”。  
> 关键词：可安装、可恢复、可诊断、可组合、可回滚。

## 0. 核心洞察（借鉴 gastown，但不照抄）

gastown 的价值不在“多 agent 叙事”，而在三件事：

1) 任务一等公民（Convoy / Issue）：让系统以“任务对象”推进，而不是靠聊天记录碰运气。  
2) 可恢复的持久化：把状态写进可审计/可回滚的载体（它用 worktree/hook + git；我们也要有自己的 ledger）。  
3) 主脑 + 工人分层：常驻协调（Mayor）≠ 临时执行（Crew/Polecat）。

msgcode 对应映射（2.2）：
- Mayor ≈ daemon（lane queue、权限、落盘、恢复、观测）
- Crew ≈ runners（lmstudio/claude/codex/jobs/media/tts/asr/vision…）
- Convoy ≈ tasks（跨消息/跨会话的“真对象”）

---

## 1. 里程碑总览（M5 → M8）

| Milestone | 目标 | 交付物（最小） | 验收口径（必须可测） |
|---|---|---|---|
| M5 可发布 daemon | 从开发态 → 可安装/可停/可自检 | launchd/pidfile、config effective、清场收口 | 重启后状态一致；doctor/config 能解释“为何如此” |
| M6 任务系统（Convoy） | 让“任务”替代“聊天”成为主线 | tasks/ 目录 + schema + CLI + runner 接入 | task 可追踪（id/status/logs），可手动/定时推进 |
| M7 worktree 隔离（repo workspace） | 失败不污染主工作区 | task run --worktree + 输出 patch | 一键生成 patch；可回滚；可比对 |
| M8 Runner 统一与能力注册 | 新能力可插拔、口径一致 | runner 接口 + capability registry + preflight/probe 对齐 | 新增能力=加 runner+deps+probe，不改主链路 |

---

## 2. M5：可发布 daemon（P0）

### 2.1 痛点
- 进程管理靠 `pkill -9 -f`：误杀风险大、不可恢复、不可观测。
- CLI 运行依赖 tsx/TS 源码：对外分发脆弱。
- 配置多真相源：`.env` + `state.json` 很容易“以为生效但没生效”。
- 仓库脏：临时产物/备份文件混入，会拖慢迭代和排错。

### 2.2 交付物（建议拆单给 Opus）
1) **daemon 生命周期收口**
   - pidfile：写入 `~/.config/msgcode/pid`
   - stop：优雅 SIGTERM，超时再 SIGKILL（不再 pkill 模糊匹配）
   - status：显示 PID/启动时间/版本/日志路径
   - logs：`msgcode logs -f`（跟 tail -f 一样）

2) **launchd 安装（macOS）**
   - `msgcode service install|uninstall|start|stop|status`
   - 产物：`~/Library/LaunchAgents/com.msgcode.plist`

3) **配置“最终生效值”输出**
   - `msgcode config effective --json`
   - 输出包含：defaults/env/state 三层 merge 后的 effective 值 + source（来自哪一层）
   - 目的：把“为什么 Serena/为什么 Base”这种排查，变成 1 条命令可复现。

4) **清场式收口**
   - 删除：`*.bak`、构建 tarball、临时目录
   - 收紧 `.gitignore`（产物/缓存/临时文件不进仓）
   - AIDOCS README 索引同步

### 2.3 验收（M5 必须）
- 重启 daemon 后：
  - routes/memory/jobs/state 均不丢、不乱、不重复处理历史消息
  - `msgcode doctor --json` 输出稳定（即便依赖缺失也能解释）
  - `msgcode config effective --json` 能解释 TTS/LMStudio/Jobs 的实际配置来源

---

## 3. M6：任务系统（Convoy）（P0/P1）

### 3.1 设计原则
- 任务文件必须“人可读/可改/可 diff”
- 任务状态必须“可恢复”（daemon 重启后续跑）
- 任务执行必须“可重放”（有 run 记录）

### 3.2 存储结构（每 workspace 一份）
```
<WORKSPACE>/
└── tasks/
    ├── index.json              # 任务索引（轻量）
    ├── <taskId>.json           # 任务对象（机器）
    ├── <taskId>.md             # 任务说明（人）
    └── runs.jsonl              # 执行记录（追加写）
```

### 3.3 Task JSON（建议）
```jsonc
{
  "id": "tsk_...",
  "title": "一句话描述",
  "status": "open|running|blocked|done|canceled",
  "createdAtMs": 0,
  "updatedAtMs": 0,
  "workspace": { "path": "..." },
  "route": { "chatGuid": "..." },         // 可选：从哪个群触发/归属
  "runner": { "kind": "lmstudio|claude|codex|opencode", "model": "auto" },
  "inputs": { "prompt": "...", "files": [] },
  "outputs": { "artifacts": [], "patches": [] },
  "notes": { "lastSummary": "" }
}
```

### 3.4 CLI（建议）
- `msgcode task add --workspace <...> --title <...>`
- `msgcode task list --workspace <...> [--status open]`
- `msgcode task show <id> --workspace <...>`
- `msgcode task run <id> --workspace <...>`（走 runner）
- `msgcode task close <id> --workspace <...> --status done|canceled`

### 3.5 验收（M6 必须）
- 任务创建后可运行，runs.jsonl 追加记录
- daemon 重启后 `task run` 不丢状态
- `doctor`/`preflight` 能识别 tasks 目录健康（可选 P1）

---

## 4. M7：worktree 隔离执行（repo workspace）（P1）

### 4.1 适用条件
- workspace 是 git repo（或含 git repo）
- 任务需要产生改动但不想污染主分支

### 4.2 最小实现
- `msgcode task run <id> --worktree`
  - 自动创建：`<WORKSPACE>/worktrees/<taskId>`
  - runner 在 worktree 内执行
  - 产出：`patch.diff` + `summary.md`

### 4.3 验收
- 主工作区无未预期改动
- worktree 可一键删除/回滚
- patch 可应用到主分支（人工确认）

---

## 5. M8：Runner 统一与能力注册（P1）

### 5.1 统一 Runner 接口
目标：新增能力不再改 listener/handler 主链路，只加一个 runner。

建议接口（概念）：
- 输入：`{ kind, workspacePath, payload, constraints, context }`
- 输出：`{ status, errorCode, errorMessage, artifacts[], preview }`

### 5.2 capability registry
- `capabilities.json`（机器可读）：每个 runner 声明依赖、输入输出、风险等级
- `preflight`/`doctor` 自动读 registry 做探测与 fixHint

---

## 6. 风险清单（控盘要盯）

- **macOS TCC**：屏幕录制/辅助功能对 daemon 限制（见 desktop plan）
- **多真相源**：env/state/routes/jobs/memory 五套状态互相覆盖 → 必须给“effective config”
- **runs.jsonl 膨胀**：需要 retention（按天/按条数）
- **高敏内容**：务必坚持 digest/length，不要在日志里落正文

---

## 7. 建议的执行顺序（给 Opus 的最短路径）

1) M5：daemon/pidfile/launchd + config effective + 清场（先把地基打牢）  
2) M6：tasks（先跑通“任务对象闭环”，再谈高级编排）  
3) M7：repo worktree（只对代码类任务启用）  
4) M8：runner/registry（让能力扩展成本持续下降）

