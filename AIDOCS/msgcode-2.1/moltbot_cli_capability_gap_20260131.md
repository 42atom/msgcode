# moltbot(openclaw) vs msgcode：CLI/能力差距对比（2026-01-31）

## 结论先行（我们该学的“骨架”）

### 1) CLI 深度 = 产品化深度
openclaw 的优势不是“命令多”，而是：
- 命令层级清晰（大量二级子命令），能覆盖“运维闭环 + 能力扩展 + 安全治理”。
- 大量命令天然适合脚本/agent 调用（`status/health/cron/...`），并配套 docs。

### 2) Cron/Jobs 是“自动化入口”，但落在可运维体系里
它的 cron 不是孤立功能，而是绑定：
- store（持久化 + 迁移）
- scheduler（单 timer + nextWake + 防卡死）
- delivery（best-effort）
- status/doctor（可诊断）

### 3) Doctor 是“把复杂性压扁”的总入口
openclaw 的 `doctor`/`status/health`/`channels status --probe` 体系，让用户不用看源码就能排障。

---

## 一张表：命令面差异（只列最关键）

| 维度 | openclaw（moltbot） | msgcode（当前） | msgcode 缺口（优先级） |
|---|---|---|---|
| 诊断入口 | `doctor`（含 fix 思路）、`status/health` 分层 | `status/probe`（且存在重复命令实现风险） | **P0：统一 doctor(JSON-first)+退出码/错误码** |
| 常驻/daemon | `daemon` 子命令（安装/管理/卸载）+ 更新流程 | `start/stop`（后台 spawn tsx），缺系统服务安装/日志管理 | **P0：launchd install/uninstall/logs** |
| Automation | `cron` 完整命令面（add/edit/list/run/runs/enable/disable）+ docs | 无（我们已写 v2.1 设计草案） | **P0：job 子命令 + store + scheduler** |
| 能力注册 | plugins/skills/models/hooks 等都有 list/info/enable/disable/check | 主要依赖“外部 tmux + 人工操作” | **P1：capabilities registry（机器可读）** |
| 配置管理 | `configure`/`config` 类命令，配套 docs | `init` + 手动编辑 env | **P1：config get/set/validate** |
| 输出机器化 | 多处具备 `--json`、并有稳定工具协议（Gateway methods） | `--json` 现在不统一（`-j/--json` 混用） | **P0：CLI Contract 统一** |

备注：openclaw 命令面广泛覆盖浏览器/多渠道/设备/安全审批等；msgcode 作为 iMessage 专用 agent 不必照抄全部，但要学习“骨架”。

---

## 深挖：openclaw 的 cron 设计要点（我们可直接复刻的）

### A) Job 数据模型清晰、状态内置
openclaw cron job（核心字段）：
- `schedule`: `at`/`every`/`cron(expr+tz)`
- `sessionTarget`: `main`/`isolated`
- `payload`: `systemEvent` 或 `agentTurn`
- `state`: `nextRunAtMs/runningAtMs/lastStatus/lastError/...`
- `delivery`: `deliver/channel/to/bestEffortDeliver`（在 payload 或 isolation 里分层）

### B) scheduler：一个 timer，且做了“工程化细节”
- 只保留 1 个 `setTimeout`，对超长 delay 做 clamp，`unref()`。
- `runningAtMs` 卡死清理，避免永远 running。

### C) 执行语义：main 注入 vs isolated 隔离
- main：enqueue system event → 触发 heartbeat（now/next-heartbeat）。
- isolated：单独跑一次 agent turn，跑完可回贴 summary/full，再可选触发 heartbeat。

对 msgcode 的映射：
- main：向“绑定群对应的 tmux session”送入一条 `tmuxMessage`。
- isolated：创建 `job:<id>` 的临时 tmux session，跑完销毁，可回发到 iMessage 群。

---

## msgcode 当前不足（从 CLI 角度的“痛点”）

### 1) 命令稳定性不足（重复定义风险）
`src/cli.ts` 当前存在 `status/probe` 的重复定义（两套实现并存），会导致：
- 用户文档/退出码/输出格式漂移
- agent 自动解读难以稳定

### 2) 缺少“daemon 安装/管理”的正式接口
现在后台启动是 spawn tsx，缺：
- launchd 安装/卸载
- 统一日志查看
- 崩溃自启/升级回滚 SOP

### 3) 缺少“自动化入口”
没有 cron/jobs，就没有“主动推进”的能力面，Agent 只能被动响应消息。

---

## 推荐路线（只做最小必需，追上骨架）

### P0（追平骨架，提升使用体验）
1) `msgcode doctor --json`（聚合诊断 + 稳定错误码/退出码）
2) `msgcode daemon install/uninstall/status/logs`（launchd）
3) `msgcode job ...`（按 `AIDOCS/msgcode-2.1/job_spec_v2.1.md` 落地）
4) CLI Contract 收口（统一 `--json`、移除重复命令）

### P1（能力面开始“可组合”）
1) `msgcode capabilities list/info --json`（注册表）
2) `msgcode config validate --json`（把 env 校验产品化）

