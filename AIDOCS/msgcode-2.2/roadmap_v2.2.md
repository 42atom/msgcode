# msgcode 2.2 路线图（控盘版）

> 目标：把 msgcode 从“能跑”升级为“可控可组合”的本地 Agent。  
> 主线叙事：**workspace 策略（真相源）→ 人格/技能/定时（编排层）→ 能力总线（MCP）→ 桌面执行（Host+Bridge）**。

---

## 1) 2.2 交付范围（只保留必要的）

### P0（必须交付）
- **workspace 策略真相源**：所有开关只落盘到 `<WORKSPACE>/.msgcode/config.json`
- **执行臂兼容（Codex 优先）**：从 iMessage 远程对话/远程办事可用；同一套路由名（routeName）稳定，按 `policy.mode` 做 egress 门禁
- **Session Registry（控盘地基）**：tmux 会话元数据落盘，daemon 重启后 `/status` 口径不漂移（见 `session_registry_spec_v2.2.md`）
- **Control Lane（只读秒回）**：`/status /where /help` 不抢占但必须秒回（见 `control_lane_spec_v2.2.md`）
- **Persona/Skills/Schedules**：人格/技能/定时任务全部可落盘、可切换、可审计（详见 `orchestration_plan_v2.2.md`）
- **MCP 总线（msgcode 自己做）**：对外暴露可控工具；高风险工具必须手机端确认
- **Desktop Automation 底座**：menubar host + bridge（先 observe，再小范围 action）（详见 desktop plan）
- **可发布 daemon**：可安装/可停/可自检（pidfile/launchd/config effective/logs）

### P1（可选）
- “任务系统/任务对象”与 worktree 隔离执行（放到 2.3 或 2.2 末尾再评估）

---

## 2) 里程碑（2.2 只做这四块）

| Milestone | 目标 | 最小交付物 | 验收口径 |
|---|---|---|---|
| M5 daemon + 执行臂 | 可安装、可停、可自检；Codex 可用 | pidfile+stop、launchd、preflight、`/model codex`、logs | 手机端可切到 codex 并稳定对话；local-only 禁止 egress |
| M6 编排层 | 人格/技能/定时落盘 | persona/skills/schedule 配置与命令面 | 切 persona 生效；skill 可启停；schedule 可恢复 |
| M7 MCP 总线 | 工具可扩展且可控 | `msgcode-mcp`（stdio）、capability manifest、`/approve` 协议、evidence 落盘 | 只读自动；副作用必须确认；证据可追溯 |
| M8 桌面执行 | 解决 TCC 与可审计动作 | host+bridge、observe/plan/run、证据包 | 能稳定 observe；最小动作闭环可复现 |

---

## 3) M5 具体交付（Codex 优先：支持远程对话）

最低验收（P0）：
- `doctor/preflight` 能明确显示 codex 是否可用（缺啥就提示啥）
- 群内可用 `/model codex`（或等价入口）切换执行臂；`/start` 启动/恢复 Codex tmux 会话后，普通消息走 codex 返回
- `/model codex` 会写入该 workspace 的默认执行臂（落盘到 `.msgcode/config.json`），避免每次重启/重连丢失
- `policy.mode=local-only` 时：任何 egress runner（codex/claude-code）必须被拒绝，并给出可执行的 fixHint（如何切到 egress-allowed）

---

## 4) M6 具体交付（Persona/Skills/Schedules）

详见：`AIDOCS/msgcode-2.2/orchestration_plan_v2.2.md`

最低验收（P0）：
- `/persona use` 后下一条消息立刻生效（同 workspace）
- `/skill enable/disable` 能改变可用能力（按 persona/workspace）
- schedule（定义=文件；执行=jobs）重启可恢复 nextRun/nextWake

补充约束（禅意）：
- skills 只从 `~/.config/msgcode/skills/` 扫描；msgcode 只做“列出 + 校验 + 启用”，编辑由用户自行在 Finder 完成
- schedules/personas/config 同理：文件即真相源；提供一个明确的“生效边界”——`Reload Config`

---

## 5) M7 具体交付（MCP 总线：借鉴 osaurus，但不依赖它）

我们只复制它的“好骨架”，不复刻它的 UI 生态：
- contract：`tools(list)` + `call(name, arguments)`，schema=JSON Schema
- 权限：`requirements + permission_policy(deny/ask/auto)` + msgcode 手机端 `/approve`
- 供应链：至少 `sha256 + receipt`（P1 再加签名）
- 可观测：每次 call 必须落盘 evidence（参数/结果/耗时/谁批准）

参考对照：`AIDOCS/msgcode-2.2/osaurus_integration_plan_v2.2.md`

---

## 6) 不纳入 2.2（明确删掉，避免控盘混乱）

- 复刻 osaurus 的 persona/schedule/agent UI
- 把 LM Studio 当中枢（它仍是模型试验场/备用 provider）
- 复杂“任务对象/多工人/多 agent”叙事（待 2.3）

---

## 7) Opus 最短执行顺序（建议）

- 先 M5：daemon 可安装/可停/可自检（否则后面都不稳）
- 再 M6：workspace config + persona/skill/schedule（编排可控）
- 再 M7：MCP 总线 + `/approve`（扩展能力 + 风控闭环）
- 最后 M8：桌面 host+bridge（见 `desktop_automation_plan_v2.2.md`，内部里程碑 M1–M4）
