# Capability Map（v2.1）

> 目标：把 msgcode 的“综合能力”抽象成可扩展、可运维、可审计的能力面。
>
> 关键原则：
> - **能力 = 可声明的接口**（可发现、可验证、可降级）
> - **默认无副作用**（Default safe；副作用必须显式确认）
> - **可恢复**（状态/证据落盘；重启不丢）
> - **模型可插拔**（路由名稳定，绑定可替换）

## 1) 核心抽象：Capability Registry

把每个能力当成一个“可注册模块”，具备以下信息：
- `id`：稳定 ID（代码/文档/Jobs 引用）
- `version`：能力自身版本（不等于产品版本）
- `sideEffects`：read-only / local-write / message-send / process-control / browser-act
- `deps`：依赖（binary、服务端口、模型路由名、权限）
- `configKeys`：需要的配置键（例如 `LMSTUDIO_BASE_URL`）
- `probes`：健康检查（doctor/probe 用）
- `commands`：CLI 子命令面（JSON-first）
- `evidence`：证据落盘策略（用于高敏/可审计能力）

建议的声明结构（草案）：

```jsonc
{
  "id": "browser.core",
  "version": 1,
  "title": "Browser Core",
  "sideEffects": ["read-only", "local-write"],
  "deps": {
    "binaries": ["chrome"],
    "services": [],
    "models": [],
    "permissions": ["host-browser-profile"]
  },
  "configKeys": ["BROWSER_PROFILE_DIR"],
  "probes": ["probe.browser.profile", "probe.browser.login"],
  "commands": ["msgcode browser status", "msgcode browser snapshot"],
  "evidence": { "enabled": true, "path": "<workspace>/artifacts/browser/<date>/<requestId>/" }
}
```

## 2) 能力分层（从底座到业务）

### L0：基础设施（必须稳定）
- `logging`：结构化日志 + digest（不落正文）
- `cli.contract`：统一 envelope/错误码/退出码
- `doctor/probe`：可观测与自检闭环
- `lanes/queue`（理念落盘）：默认串行，显式并行（参考 OpenClaw 的 lane 思路）

### L1：渠道与会话（msgcode 的主线）
- `imessage.gateway`：iMessage 收发、去重、白名单、路由
- `workspace.routing`：chatGuid → workspace 隔离
- `tmux.session`：会话生命周期（start/stop/snapshot/esc/clear）

### L2：本地能力手臂（可组合）
- `files.vault`：附件/导出/证据落盘（可审计）
- `runner.exec`：本地 runner 执行（ASR/TTS/生图/视频/脚本）
- `vision.ocr`：OCR（`ocr-vl` 路由）
- `vision.understanding`：视觉理解（`vision` 路由）
- `memory.store`：Markdown 为真相（workspace 隔离）
- `memory.search`：FTS5/BM25（P0）→ Hybrid（P2）
- `jobs.scheduler`：定时/可恢复（main vs isolated）

### L3：对外通道（高价值但要控风险）
- `email.send`：发送邮件（交付日报/回执/告警）
- `calendar.reminders`：日历/提醒事项（低风险高收益）
- `browser.core`：语义快照 + 下载 + 截图
- `browser.act`：填表/点击提交（高敏，必须二次确认）

### L4：业务包（Domain Packs）
业务包只提供 schema/校验/站点策略，不应越权到执行框架：
- `tax.pack`：税务/记账（案例）
- `social.pack`：发帖/运营后台（案例）
- `finance.pack`：对账/发票归档（案例）

## 3) 模型路由（插拔点）

路由名稳定化见：`model_routing_spec_v2.1.md`。

推荐最小路由名集合：
- `chat-main`
- `vision`
- `ocr-vl`
- `mem-embed`
- `mem-rerank`

调用方（CLI/daemon/jobs/runner）只引用路由名，不引用具体模型 key。

## 4) 安全与确认（能力必须声明副作用）

副作用分级（与 `cli_contract_v2.1.md` 对齐）：
- read-only
- local-write
- message-send
- process-control
- browser-act

统一策略：
- 任何 `browser-act/message-send/process-control` 都必须支持 `--dry-run` 或 `--confirm`。
- 高敏能力必须落盘证据包（requestId 关联）。

## 5) P0/P1/P2 路线（建议）

### P0（把骨架补齐：可用、可诊断、可恢复）
- CLI contract 收口：envelope + 错误码枚举
- doctor/probe：把“为何不回/为何失败”一次性说清
- attachments + ASR：语音消息 → vault → ASR runner → 文本
- memory：Markdown + FTS5（workspace 隔离）
- jobs：落盘 + 可恢复（先支持 cron/at/every + runlog 保留）

### P1（把体验补齐：可交付、可自动化）
- browser core：语义快照 + 下载 + 证据包（无提交）
- email：日报/告警/回执交付
- calendar/reminders：把计划写进系统

### P2（把“强智能”补齐：更准、更省、更稳）
- memory hybrid：embedding + rerank（本地模型，TTL 按需加载）
- browser-act：两段式提交（强制证据）
- 更强的 lane/queue：明确可并行边界，避免并发污染

