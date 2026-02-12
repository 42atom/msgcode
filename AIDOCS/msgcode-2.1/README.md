# msgcode 2.1（Design Notes）

> 目标：在不污染主链路（iMessage 收发 + 路由 + tmux 会话）的前提下，把"常驻能力"补齐：**Jobs/定时** + **机器可解析诊断**。

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
├── jobs_m3_execution_plan.md # Jobs M3 执行计划与验收记录
├── memory_spec_v2.1.md    # Memory（分项目隔离 + 管家视图）设计草案 v2.1（FTS5/BM25）
└── tax_browser_workflow_spec_v2.1.md # 记账/报税（高敏）浏览器工作流规范 v2.1
```

## 实现进度（2026-02-01）

| 里程碑 | 状态 | 说明 |
|--------|------|------|
| **M1** | ✅ 完成 | CLI Contract 收口到 Envelope（JSON-first）+ 退出码一致 |
| **M2** | ✅ 完成 | Memory P0（Markdown SoT + FTS5）闭环成立 |
| **M3** | ✅ 完成 | Jobs P0（daemon 生命周期 + lane 串行 + 落盘 + doctor 口径 + 错误码） |
| **M4-B** | ✅ 完成 | Dependencies Manifest + Preflight（fail-fast + 降级） |

### 技术债记录

| 缺口 | 优先级 | 说明 |
|------|--------|------|
| P0+ 成功路径验证 | P0+ | 需在 tmux+iMessage 环境验证 `runs.jsonl status:"ok"`（当前只验证了错误路径） |
| daemon 停止策略优化 | P1 | `stopBot()` 使用 pkill -9 -f 过于粗暴，建议改用 pidfile 管理 |

### M4-B：Dependencies Manifest + Preflight

**目标**：把运行依赖显式落到 manifest，start 前 preflight 校验；缺席就 fail-fast（或降级），不等运行中爆雷。

**实现要点**：
- `src/deps/manifest.json`：默认依赖清单（requiredForStart/requiredForJobs/optional）
- `src/deps/load.ts`：加载默认 manifest + 用户覆盖（~/.config/msgcode/deps.json）
- `src/deps/preflight.ts`：依赖校验逻辑（bin/fs_read/http）
- `msgcode preflight --json`：独立检查命令
- `startBot()` fail-fast：requiredForStart 缺失则退出
- doctor 集成：deps probe 输出到 `msgcode doctor --json`

**使用方式**：
```bash
# 检查依赖
msgcode preflight          # 文本格式
msgcode preflight --json   # Envelope 格式（exitCode: 1=error, 2=warning）

# 依赖检查集成到 doctor
msgcode doctor --json      # 包含 deps 类别

# 启动时自动校验（fail-fast）
msgcode start              # requiredForStart 缺失则退出
```

## 约束（2.1 总原则）
- JSON-first：所有状态/诊断都必须可机器解析（便于 agent/脚本自动解读）。
- 最小权限：禁止任意 shell 执行；只允许“往 tmux 会话送消息”这种可控副作用。
- 可观测：每个 job 的 nextRun/lastRun/lastError 都落盘，可被 `probe/doctor` 读取。
- 可恢复：job 状态落盘；daemon 重启后自动恢复调度与 nextWake 计算（不依赖内存状态）。
- 附件与本地能力：语音消息 → attachment vault → ASR runner → 转写文本。
- 记忆注入默认关闭：按 workspace 配置开关（`<WORKSPACE>/.msgcode/config.json`），避免“串味/污染”。

## 下一步（规划）
- **记忆注入开关**：群内 `/mem on|off|force` 控制当前 workspace 是否允许自动检索注入（详见 `AIDOCS/msgcode-2.1/memory_spec_v2.1.md:1`）。
- **Mac 仪表盘（薄壳 MVP）**：只消费 `msgcode * --json` 作为数据源（doctor/preflight/routes/memory/jobs），提供 workspace 列表 + 配置开关 + 快捷动作（打开目录/重建索引/查看日志）。
