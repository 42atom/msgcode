# msgcode 2.1（Design Notes）

> 目标：在不污染主链路（iMessage 收发 + 路由 + tmux 会话）的前提下，把“常驻能力”补齐：**Jobs/定时** + **机器可解析诊断**。

## 目录

```
AIDOCS/msgcode-2.1/
├── README.md              # 本目录索引
├── attachments_spec_v2.1.md # Attachments（含语音消息）能力设计 v2.1
├── browser_automation_spec_v2.1.md # 浏览器自动化（通用底座）规范 v2.1
├── capability_map_v2.1.md # 综合能力地图（Capability Registry）v2.1
├── cli_contract_v2.1.md   # CLI 契约（JSON-first/退出码/错误码/隐私/副作用）
├── lmstudio_prompts/      # LM Studio 模型专用 Prompt Template（可版本化资产）
├── model_routing_spec_v2.1.md # 模型路由（稳定路由名→可插拔绑定）规范 v2.1
├── local_runners_spec_v2.1.md # Local runners（TTS/生图/视频/ASR）统一封装 v2.1
├── moltbot_cli_capability_gap_20260131.md # 与 moltbot(openclaw) CLI/能力差距对比
├── job_spec_v2.1.md       # Jobs（定时/周期任务）设计草案 v2.1
├── memory_spec_v2.1.md    # Memory（分项目隔离 + 管家视图）设计草案 v2.1（FTS5/BM25）
└── tax_browser_workflow_spec_v2.1.md # 记账/报税（高敏）浏览器工作流规范 v2.1
```

## 约束（2.1 总原则）
- JSON-first：所有状态/诊断都必须可机器解析（便于 agent/脚本自动解读）。
- 最小权限：禁止任意 shell 执行；只允许“往 tmux 会话送消息”这种可控副作用。
- 可观测：每个 job 的 nextRun/lastRun/lastError 都落盘，可被 `probe/doctor` 读取。
- 可恢复：job 状态落盘；daemon 重启后自动恢复调度与 nextWake 计算（不依赖内存状态）。
- 附件与本地能力：语音消息 → attachment vault → ASR runner → 转写文本。
