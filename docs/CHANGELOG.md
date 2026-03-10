# Changelog

## Protocol Entries（CLAUDE.md 约束格式）

- 2026-03-10
  - skills: repo 内置技能新增 `optional` 扩展层；`twitter-media`、`veo-video`、`screenshot`、`scrapling`、`reactions` 会同步到 `~/.config/msgcode/skills/optional/`，但不会并入默认常驻主索引，模型仅在主索引无匹配时按需读取 `optional/index.json` (Issue: 0070, Plan: docs/design/plan-260310-optional-runtime-skills-on-demand.md) [risk: low] [rollback: 删除 `src/skills/optional/`、回退 `src/skills/runtime-sync.ts`、`src/skills/README.md`、`prompts/agents-prompt.md` 与相关测试]
  - feishu: 新增 `feishu_list_members` 只读工具，可直接拉当前飞书群的 `senderId + name`；同时系统提示词新增飞书群聊定向回复的 `@` 规则，`character-identity` skill 也支持先用成员列表初始化 CSV 通讯录 (Issue: 0069, Plan: docs/design/plan-260310-feishu-member-roster-tool-and-mention-guidance.md) [risk: medium] [rollback: 回退 `src/tools/feishu-list-members.ts`、飞书工具注册、`prompts/agents-prompt.md` 与相关测试]
  - runtime: Agent Core Phase 4 已把 `message / task / heartbeat / schedule / tool-loop` 收口到统一 Run Events；`run-store` 现在会自动落 `run:start / run:end / run:error` 到 `~/.config/msgcode/run-core/run-events.jsonl`（可由 `MSGCODE_RUN_EVENTS_FILE_PATH` 覆盖），tool-loop 链也会补 `run:tool / run:assistant / run:block`，同时保持不引入 event bus / WebSocket 控制面 (Issue: 0066, Plan: docs/design/plan-260310-agent-core-gap-vs-openclaw.md) [risk: medium] [rollback: 回退 `src/runtime/run-events.ts`、`src/runtime/run-store.ts`、`src/agent-backend/routed-chat.ts`、`src/handlers.ts`、`src/commands.ts`、`src/runtime/task-supervisor.ts` 与相关 Phase 4 测试]
  - runtime: Agent Core Phase 3 已把普通消息链与 task 续跑链的 `summary/window/checkpoint/compact` 收口到统一 `context-policy` helper；`handlers.ts` 不再独占 compaction 主逻辑，tool preview 裁剪也复用同一 helper，同时保持 Phase 1/2 的 `runId/sessionKey/source` 主链不变 (Issue: 0066, Plan: docs/design/plan-260310-agent-core-gap-vs-openclaw.md) [risk: medium] [rollback: 回退 `src/runtime/context-policy.ts`、`src/handlers.ts`、`src/commands.ts`、`src/agent-backend/prompt.ts`、`src/agent-backend/tool-loop.ts` 与相关 Phase 3 测试]
  - runtime: Agent Core Phase 2 已把 `chatId + workspace + channel` 收口为稳定 `sessionKey`；Run Core 现在会在 `beginRun()` 统一为 message、`/task`、heartbeat、schedule 解析并记录 `sessionKey`，同 chat 同 workspace 的四条主链可追到同一会话，schedule 缺 route/workspace 时则 fail-closed 落 `orphan` session key (Issue: 0066, Plan: docs/design/plan-260310-agent-core-gap-vs-openclaw.md) [risk: medium] [rollback: 回退 `src/runtime/session-key.ts`、`src/runtime/run-store.ts`、`src/runtime/run-types.ts` 与 Phase 2 测试]
  - runtime: Agent Core Phase 1 已引入薄的 Run Core；普通消息、`/task run|resume`、heartbeat 任务续跑与 schedule 执行现在都会生成统一 `runId/source/status` 记录并落到 `~/.config/msgcode/run-core/runs.jsonl`（可由 `MSGCODE_RUNS_FILE_PATH` 覆盖），普通消息链也会把 `runId` 复用为 agent `traceId`，同时保持 `/task` 的长期任务语义不变 (Issue: 0066, Plan: docs/design/plan-260310-agent-core-gap-vs-openclaw.md) [risk: medium] [rollback: 回退 `src/runtime/run-*`、`src/handlers.ts`、`src/runtime/task-supervisor.ts`、`src/routes/cmd-task-impl.ts`、`src/jobs/runner.ts` 与相关测试]
  - runtime: `permissions` probe 已按 transport 条件化；未启用 `imsg` 时不再无条件检查 `~/Library/Messages` 与 `chat.db`，避免 Feishu-only 部署因本地 iMessage 权限缺失被 `msgcode status` 误判为 error (Issue: 0064, Plan: docs/design/plan-260310-permissions-probe-imsg-conditional.md) [risk: low] [rollback: 回退 `src/probe/probes/permissions.ts` 与相关测试]
  - runtime: 修复 `preflight` 与默认 transport 口径漂移；`loadManifest()` 现在会按本轮 transport 解析结果动态提升真正的启动必需依赖，避免 fallback-imsg 场景仍显示 `0/0` 启动必需，同时保持 Feishu-first 的静态 manifest 不变 (Issue: 0063, Plan: docs/design/plan-260310-preflight-transport-aware-startup-deps.md) [risk: medium] [rollback: 回退 `src/deps/load.ts`、`src/config/transports.ts` 与相关 preflight 测试]
  - runtime: 默认通道口径已收口为 `Feishu-first, iMessage-optional`；无显式 `MSGCODE_TRANSPORTS` 时，有飞书凭据默认只启 `feishu`，否则回退 `imsg`，同时 `imsg/messages_db` 退出全局启动硬依赖，README 快速开始也同步切到飞书主通道 (Issue: 0062, Plan: docs/design/plan-260310-feishu-first-imsg-optional.md) [risk: medium] [rollback: 回退 `src/config.ts`、`src/deps/manifest.json`、`README.md` 与相关测试]
  - runtime: macOS 下 `msgcode start/stop/restart` 已收口到 LaunchAgent 主链；daemon 由 `launchd` 托管常驻，`msgcode status` 新增 daemon 托管状态诊断，且 launchd 会话里 `imsg` 初始化失败时不再拖垮整进程，而是自动降级为保留其余 transport 常驻 (Issue: 0061, Plan: docs/design/plan-260310-msgcode-daemon-keepalive-via-launchd.md) [risk: medium] [rollback: 回退 `src/runtime/launchd.ts`、`src/cli.ts`、`src/daemon.ts`、`src/commands.ts` 与 daemon probe 改动]
  - skills: 退役 `zai-vision-mcp` runtime skill；正式视觉能力面收口为“当前模型原生看图 + 本地 LM Studio”，runtime skill sync 也会把 `zai-vision-mcp` 视为 retired skill，不再继续暴露到用户索引 (Issue: 0060, Plan: docs/design/plan-260310-retire-zai-vision-mcp-runtime-skill.md) [risk: low] [rollback: 恢复 `src/skills/runtime/zai-vision-mcp/`、`src/skills/runtime/index.json` 与 runtime skill sync 测试]
  - runtime: 修复 review 暴露的长期任务状态机漂移；`updateTaskResult()` 现在尊重显式 `status`，`failed` 不再被错误回退成 `pending`，无 verify 的 `completed` 会与 checkpoint 一起降级回 `running`，同时 `/task resume` 不再在真正续跑前先消耗一次 attempt budget (Issue: 0059, Plan: docs/design/plan-260310-review-fixes-task-status-and-runtime-skill-index.md) [risk: medium] [rollback: 回退 `src/runtime/task-supervisor.ts` 与相关 `/task` 测试]
  - skills: 修复 runtime skill 索引与仓库真相源失配；把 `vision-index`、`local-vision-lmstudio`、`zai-vision-mcp` 正式纳入仓库托管 runtime skills，并新增“索引列出的托管 skill 必须被 git 跟踪”的回归锁，避免 clean checkout 下 skill 索引悬空 (Issue: 0059, Plan: docs/design/plan-260310-review-fixes-task-status-and-runtime-skill-index.md) [risk: low] [rollback: 回退 vision runtime skill 目录、`src/skills/runtime/index.json` 与 runtime skill sync 测试]
  - agent-backend: 对话链路与 tool-loop 的短期上下文注入改为共用同一套 budget assembler；`summaryContext`、recent window、单条消息截断现在按统一预算装配，并优先保留最新消息，减少旧大消息挤掉新状态造成的突然失忆 (Issue: 0058, Plan: docs/design/plan-260310-long-running-agent-context-smoothing.md) [risk: low] [rollback: 回退 `src/agent-backend/prompt.ts`、`src/agent-backend/tool-loop.ts` 与相关测试]
  - skills: 新增 `plan-files` runtime skill，正式把 file-first planning 收口为任务内文件工作记忆说明书；复杂任务可按 skill 落计划文件，但不新增 `/plan` 模式，不替代 memory，也不替代 `/task`，同时 runtime skill 规则收口为“`SKILL.md` 为正式入口，`main.sh` 仅在确有稳定 wrapper 时才提供” (Issue: 0057, Plan: docs/design/plan-260310-plan-files-runtime-skill.md) [risk: low] [rollback: 删除 `src/skills/runtime/plan-files/`、回退 `src/skills/runtime/index.json`、`src/skills/README.md` 与 `test/p5-7-r13-runtime-skill-sync.test.ts`]
  - browser: 收口 browser 的 `instanceId` 合同提示；system prompt、browser manifest 与 `patchright-browser` runtime skill 现在明确要求 `tabs.list` / `instances.stop` 必须复用真实 `instanceId`，并删除错误的无参示例，避免模型再次裸调失败 (Issue: 0056, Plan: docs/design/plan-260310-browser-instanceid-contract-drift.md) [risk: low] [rollback: 回退 `src/agent-backend/tool-loop.ts`、`src/tools/manifest.ts`、`src/skills/runtime/patchright-browser/SKILL.md` 与相关测试]
  - vision: 视觉请求默认输出预算从 `500` 提升到 `2048`，避免表格/长文本图片在 LM Studio 返回 `finish_reason=length` 时只吐出前半段内容；同时补充回归测试锁，防止后续又被改回低上限 (Issue: 0054, Plan: docs/design/plan-260309-vision-detail-skill-first-provider-neutral.md) [risk: low] [rollback: 回退 `src/runners/vision.ts` 与 `test/p5-7-r23-vision-mainline.test.ts`]
- 2026-03-09
  - runtime: 本地模型统一加入 2 次 `load` 后重试策略；`chat`、图片预览 `vision`、`tts emotion` 在未加载、unloaded、crash 等可恢复场景下会先尝试调用 LM Studio load 端点再重试，文本模型解析也允许在“无已加载模型”时先取 catalog model key 继续恢复 (Issue: 0055, Plan: docs/design/plan-260309-local-model-load-retry.md) [risk: medium] [rollback: 回退 `src/runtime/model-service-lease.ts`、`src/agent-backend/chat.ts`、`src/runners/vision.ts`、`src/runners/tts/emotion.ts` 与相关测试]
  - agent-backend: tool-loop 回灌模型的 `tool_result` 统一裁成 4000 字符，避免 `read_file` 大结果或长 skill 文档原文直接顶爆 provider context window，导致 `invalid_request_error: context window exceeds limit` (Issue: 0054, Plan: docs/design/plan-260309-vision-detail-skill-first-provider-neutral.md) [risk: low] [rollback: 回退 `src/agent-backend/tool-loop.ts` 与 `test/p5-7-r25-tool-result-context-clip.test.ts`]
  - agent-backend: 执行核提示词与工具索引新增“不得编造工具成功/失败、不得复述上一轮失败、缺少当前附件/路径时不得假装已读图”硬约束，收口文本追问旧图片时凭空复述 `vision` 崩溃的事故 (Issue: 0054, Plan: docs/design/plan-260309-vision-detail-skill-first-provider-neutral.md) [risk: low] [rollback: 回退 `prompts/fragments/exec-tool-protocol-constraint.md`、`src/tools/manifest.ts` 与相关测试]
  - skills: vision 相关 skill 文案收口成更接近 API 文档的“真实调用合同”；系统提示不再统一暗示所有 skill 都走 `main.sh`，vision skill index metadata 也改为指向 `SKILL.md`，减少模型自行拼装 wrapper/伪脚本路径的概率 (Issue: 0054, Plan: docs/design/plan-260309-vision-detail-skill-first-provider-neutral.md) [risk: low] [rollback: 回退 `src/agent-backend/tool-loop.ts`、`src/skills/runtime/index.json`、vision 相关 `SKILL.md` 与测试]
  - vision: 新增 skill-first 详细视觉入口 `vision-index`、`local-vision-lmstudio`、`zai-vision-mcp`；模型读取 skill 时改为先读 `SKILL.md` 再按需执行 `main.sh`，让详细读图回到说明书与 provider skill，而不是继续堆进 runtime `vision` (Issue: 0054, Plan: docs/design/plan-260309-vision-detail-skill-first-provider-neutral.md) [risk: medium] [rollback: 回退新增 runtime skills、`src/agent-backend/tool-loop.ts` 与相关测试]
  - vision: `vision` 退出默认 LLM 工具暴露；系统继续保留图片预览摘要内部能力，但图片-only 场景不再伪造“请用一句话概括主要内容”，且 `/tool allow` 不再把 `vision` 当作用户可配置的详细视觉工具展示 (Issue: 0054, Plan: docs/design/plan-260309-vision-detail-skill-first-provider-neutral.md) [risk: medium] [rollback: 回退 `src/tools/manifest.ts`、`src/listener.ts`、`src/routes/cmd-tooling.ts` 与相关测试]
  - tools: `mem` 不再作为默认 LLM tool 暴露，也不再出现在默认 workspace allow 与 `/tool allow` 用户口径里；原因是执行层当前没有对应 P0 实现，继续暴露只会制造“模型能看到但不能执行”的假能力 (Issue: 0054, Plan: docs/design/plan-260309-vision-detail-skill-first-provider-neutral.md) [risk: low] [rollback: 回退 `src/tools/manifest.ts`、`src/config/workspace.ts`、`src/routes/cmd-tooling.ts` 与相关测试]
  - vision: 图片自动主链收口为“只做摘要预览”；listener 不再偷用用户文本做自动视觉预处理，`vision` 在有 query 时不再被系统压成一句话回答，结果缓存改为按“图片 + query”分离，并补齐 `vision.userQuery` 工具合同，避免主模型继续只传 `imagePath` 导致详细视觉任务回落到摘要路径 (Issue: 0053, Plan: docs/design/plan-260309-vision-auto-summary-mainline.md) [risk: medium] [rollback: 回退 `src/listener.ts`、`src/media/pipeline.ts`、`src/runners/vision.ts`、`src/tools/bus.ts`、`src/tools/manifest.ts` 与相关测试]
  - tools: `asr` 工具说明书与执行层合同收口为“对外主字段 `audioPath`，执行层兼容 `audioPath ?? inputPath`”，避免飞书语音等附件链路继续因空路径失败 (Issue: 0046, Plan: docs/design/plan-260309-asr-tool-contract-mismatch.md) [risk: low] [rollback: 回退 `src/tools/bus.ts`、`test/p5-7-r22-asr-tool-contract.test.ts` 与相关文档改动]
  - routes: `/bind` 与 `/where` 改为展示真实运行态；agent 模式显示全局 `Agent Backend`，tmux 模式显示 `Tmux Client`，不再被 workspace `runner.default` 的 legacy 值误导 (Issue: 0050) [risk: low] [rollback: 回退 `src/routes/cmd-bind.ts` 与 `test/routes.commands.test.ts` 本轮改动]
  - routes: 新群首次落到 `default` workspace 时会直接持久化为真实 route，`/bind` 回归为“切换文件夹”用途；依赖 route store 的 `schedule add` 等链路不再因为 default 仅是临时 fallback 而报“工作区未绑定到任何群组” (Issue: 0051, Plan: docs/design/plan-260309-default-workspace-initial-binding.md) [risk: medium] [rollback: 回退 `src/router.ts` 与本轮 default workspace 回归测试]
  - agent-backend: finish supervisor 收口 MiniMax `thinking` 结论、宽松 PASS/CONTINUE 解析，并在“已验证成功但 supervisor 空返/乱返”时最小放行，避免任务已完成却被 `FINISH_SUPERVISOR_BLOCKED` 假拦截；同时日志补充 `source/rawPreview` 便于下次定位 (Issue: 0052, Plan: docs/design/plan-260309-finish-supervisor-false-block.md) [risk: medium] [rollback: 回退 `src/agent-backend/tool-loop.ts` 与本轮 supervisor 回归测试]
- 2026-03-08
  - agent-backend: finish supervisor 不再只覆盖正常收尾；工具失败的直接结束路径已并入同一个结束前监督口，失败仍保留真实 `TOOL_EXEC_FAILED` / 退出码 / stderr 语义，若监督连续 3 次要求继续则按既有协议阻塞退出 (Issue: 0044, Plan: docs/design/plan-260308-finish-supervisor-failure-paths.md) [risk: medium] [rollback: 回退 `src/agent-backend/tool-loop.ts` 与 `test/p5-7-r20-minimal-finish-supervisor.test.ts`、`test/p5-7-r10-minimax-anthropic-provider.test.ts` 本轮改动]
  - skills: `scheduler` runtime skill 的 `add` 合同明确收口为 `<schedule-id> --workspace --cron --tz --message`，并在 wrapper 层新增透明 `--tz` 兜底（仅 `add` 且缺参时使用当前会话/系统 IANA 时区，不改 CLI 真相源），避免自然语言 schedule 创建继续因缺 `--tz` 失败 (Issue: 0043, Plan: docs/design/plan-260308-scheduler-add-tz-contract.md) [risk: medium] [rollback: 回退 `src/skills/runtime/scheduler/SKILL.md`、`src/skills/runtime/scheduler/main.sh` 与相关测试本轮改动]
  - agent-backend: `routed-chat.ts` 删除 `degrade -> no-tool` 与 `forceComplexTool` 入口裁判，默认统一进入 `runAgentToolLoop()`；兼容类型同步去掉 `hasToolsAvailable/forceComplexTool` 残影，路由结果收口为 `no-tool | tool`，不再由入口层产出 `router/degrade` 决策来源 (Issue: 0042, Plan: docs/design/plan-260308-routed-chat-unshackle-phase3.md) [risk: high] [rollback: 回退 `src/agent-backend/routed-chat.ts`、`src/agent-backend/types.ts`、`src/lmstudio.ts` 与相关测试本轮改动]
  - agent-backend: 移除 `prompt.ts` 与 `tool-loop.ts` 中剩余的流程裁判器；默认不再强制 `tool_calls`、不再按 preferred tool 顺序判死，默认 quota 提高到 99+ 次工具调用，旧的 20/64 hard cap 不再作为普通主链阻断条件 (Issue: 0041, Plan: docs/design/plan-260308-llm-unshackle-phase2-remove-control-logic.md) [risk: high] [rollback: 回退 `src/agent-backend/prompt.ts`、`src/agent-backend/tool-loop.ts` 与相关测试本轮改动]
  - agent-backend: tool-loop 收口新增“结束前最小监督闭环”；主 Agent 准备结束时会默认复用当前模型做一次 `PASS/CONTINUE` 复核，`CONTINUE` 会回灌主链继续执行，连续 3 次仍未通过则明确阻塞返回，且只新增最小配置 `SUPERVISOR_ENABLED/SUPERVISOR_TEMPERATURE/SUPERVISOR_MAX_TOKENS` (Issue: 0040, Plan: docs/design/plan-260308-minimal-finish-supervisor.md) [risk: medium] [rollback: 回退 `src/agent-backend/tool-loop.ts`、`src/config.ts` 与 `test/p5-7-r20-minimal-finish-supervisor.test.ts` 本轮改动]
  - schedule: `schedule -> jobs -> scheduler` 主链收口为单一路径；新建/启用 schedule 会立即写出 `nextRunAtMs`，CLI 与聊天命令在 add/remove/enable/disable 后都会主动 refresh/rearm scheduler，不再依赖重启或人工清理 (Issue: 0038, Plan: docs/design/plan-260308-schedule-scheduler-refresh-on-mutation.md) [risk: high] [rollback: 回退 `src/jobs/schedule-sync.ts`、`src/jobs/scheduler.ts`、`src/config/schedules.ts`、`src/cli/schedule.ts`、`src/routes/cmd-schedule.ts` 与 `src/commands.ts` 本轮改动]
  - scheduler: `refresh` 文件日志补充 `reason/jobCount/rearmed/jobsPath` 观测，并将 `NODE_ENV=test` 下的文件日志默认隔离，避免测试 scheduler 把起停/refresh 记录污染到正式 `msgcode.log`、制造假性 refresh 风暴 (Issue: 0039, Plan: docs/design/plan-260308-scheduler-refresh-storm-diagnosis.md) [risk: low] [rollback: 回退 `src/jobs/scheduler.ts`、`src/logger/index.ts`、`src/logger/file-transport.ts`、`src/commands.ts`、`src/jobs/schedule-sync.ts` 与相关测试]
- 2026-03-07
  - browser: 正式浏览器主链从 PinchTab 切到 Patchright `connectOverCDP`，实例真相源改为共享工作 Chrome，`snapshot/action` 改用无状态 `role + name + index` ref，并把 runtime skill、prompt、CLI/manifest 一并切到 Chrome-as-State 口径 (Issue: 0016, Plan: docs/design/plan-260307-patchright-browser-cutover.md) [risk: high] [rollback: 回退 `src/runners/browser-patchright.ts` 与 browser CLI/tool-loop/skills/prompt 本轮改动，恢复 PinchTab 接线]
  - browser: `[historical, superseded by Issue 0016]` `tabs.open` 缺失 `instanceId` 时会自动拉起默认 PinchTab 实例；若传入不存在的 `profileId` 也会自动忽略并退回默认 launch，并在结果中回传 `instanceId`，让“打开网页”类请求可以走通单次 browser happy path (Issue: 0020, Plan: docs/design/plan-260307-browser-open-happy-path.md) [risk: medium] [rollback: 回退 `src/runners/browser-pinchtab.ts`、`src/tools/manifest.ts`、`prompts/agents-prompt.md` 与对应测试]
  - tooling: 运行时 `llm-tool-call` allowlist 与默认 LLM 工具暴露层收口到同一过滤逻辑；未暴露工具会在执行前被直接拒绝，并新增整轮 `toolSequence` 日志便于排障 (Issue: 0019, Plan: docs/design/plan-260307-tool-bridge-runtime-hardening.md) [risk: medium] [rollback: 回退 `src/tools/bus.ts`、`src/agent-backend/tool-loop.ts`、`src/agent-backend/routed-chat.ts`、`src/handlers.ts`、`src/logger/file-transport.ts` 与对应测试]
  - tooling: 模型默认文件工具面收口为 `read_file + bash`；`write_file/edit_file` 保留兼容实现但退出默认 LLM 暴露、默认 workspace allow、`/pi on` 自动注入与命令提示主链 (Issue: 0018, Plan: docs/design/plan-260307-tool-surface-slimming-for-llm.md) [risk: medium] [rollback: 回退 `workspace/tool-loop/lmstudio/prompt/cmd-*` 与相关测试本轮改动]
  - agent-backend: `edit_file` 参数合同与执行层统一为“`edits[]` + `oldText/newText` 简写兼容”，并将 `edit_file/write_file/browser` 的显式工具偏好放宽为可退回 `bash`，减少 `MODEL_PROTOCOL_FAILED` 型失败 (Issue: 0017, Plan: docs/design/plan-260307-tool-success-over-protocol-friction.md) [risk: medium] [rollback: 回退 `src/agent-backend/tool-loop.ts`、`src/tools/bus.ts`、`src/tools/manifest.ts` 与对应测试]
  - skills: `[historical, superseded by Issue 0016]` 仓库新增托管 runtime skill 真相源，`msgcode init/start` 会幂等同步 `pinchtab-browser` 到 `~/.config/msgcode/skills/`，避免安装目录缺失导致 skill 依赖丢失 (Issue: 0014, Plan: docs/design/plan-260307-runtime-skill-source-sync.md) [risk: medium] [rollback: 回退 `src/skills/runtime*`、`src/cli.ts`、`src/commands.ts` 本轮改动]
  - browser: `[historical, superseded by Issue 0016]` `startBot` 预启动本地 PinchTab，并向执行核注入 PinchTab baseUrl、binary path 与共享工作 Chrome 路径，正式浏览器通道收口为 PinchTab 单一路径 (Issue: 0013, Plan: docs/design/plan-260307-pinchtab-single-browser-substrate-bootstrap.md) [risk: medium] [rollback: 回退 `src/browser/pinchtab-runtime.ts`、`src/commands.ts`、`src/agent-backend/tool-loop.ts` 与 prompt 本轮改动]
  - feishu: 当前会话上下文写入 workspace `.msgcode/config.json`，`feishu_send_file` 缺省读取 `runtime.current_chat_id`，并修复上传失败被误判为成功的问题 (Issue: 0011, Plan: docs/design/plan-260307-feishu-send-file-runtime-context.md) [risk: medium] [rollback: 回退 `listener/config/tools/feishu` 本次改动，恢复显式 chatId + 旧发送语义]
  - agent-backend: `minimax` provider 切换到 Anthropic-compatible 推荐接法，新增独立 provider 适配、Anthropic tool schema 映射与多轮 `tool_use/tool_result` 回灌 (Issue: 0010, Plan: docs/design/plan-260307-minimax-anthropic-provider.md) [risk: medium] [rollback: 回退 `src/providers/minimax-anthropic.ts` 及 `chat/tool-loop/config` 本次接线]
- 2026-03-06
  - browser: `[historical, superseded by Issue 0016]` 引入 `pinchtab@0.7.7` 作为浏览器底座依赖，并记录首轮真实验证结论（优先对接 HTTP API，避免直接包 CLI 主链路） (Issue: 0004, Plan: docs/design/plan-260306-web-transaction-platform-core.md) [risk: medium] [rollback: 移除 `pinchtab` 依赖并回退 README/验证文档更新]
  - browser: `[historical, superseded by Issue 0016]` 收口 PinchTab timeout 与 baseUrl 语义，新增 `BROWSER_TIMEOUT` / `BROWSER_ORCHESTRATOR_URL_REQUIRED`，并将 browser timeout 向上映射为 `TOOL_TIMEOUT` (Issue: 0004, Plan: docs/design/plan-260306-web-transaction-platform-core.md) [risk: low] [rollback: 回退 `src/runners/browser-pinchtab.ts`、`src/tools/bus.ts`、README 本次修复]
  - browser: 新增共享工作 Chrome 根目录口径与 `msgcode browser root` 命令，默认路径固定为 `$WORKSPACE_ROOT/.msgcode/chrome-profiles/<name>` (Issue: 0004, Plan: docs/design/plan-260306-web-transaction-platform-core.md) [risk: low] [rollback: 回退 `src/browser/chrome-root.ts`、`src/cli/browser.ts`、README 本次更新]
- 2026-02-23
  - refactor: agent-backend 核心模块拆分与 lmstudio 兼容壳化 (Issue: 0002, Plan: docs/design/plan-260223-r9-t7-agent-backend-core-extraction.md) [risk: high] [rollback: 回退 commits 771fa49 和 4e13c0d 恢复 lmstudio.ts 主实现]
  - docs: 建立文档协议目录（issues/design/notes/adr）并迁移 changelog 主路径到 `docs/CHANGELOG.md` (Issue: 0001, Plan: docs/design/plan-260223-r9-t8-repo-protocol-alignment.md) [risk: medium] [rollback: 保留根 CHANGELOG stub，恢复脚本检查前版本]

---

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.0] - 2026-02-17

### Added
- SOUL Mod Market（安装/切换/回滚）：
  - `msgcode soul market list`
  - `msgcode soul market install <source>`
  - `msgcode soul use <id>[@version]`
  - `msgcode soul rollback`
- PI Debug 字段：`activeSoulId`、`activeSoulVersion`
- 发布文档：`docs/release/v2.3.0.md`

### Changed
- Slash 命令收敛到注册表渲染（`/help` 与注册表一致）
- `/soul` 进入主命令路径，修复“识别但不处理”的黑洞问题
- 未知命令提示改为从注册表动态生成
- README 首屏定位更新为“Mac 上的 AI 智能体，iMessage 通道优先”

### Deprecated
- `/persona` 命令族退役（保留兼容提示壳）

### Migration
- 请将 `/persona` 操作迁移到 `/soul`
- `schedule` 作为独立命令保留，不再作为 `soul` 别名

### Verification
- `npx tsc --noEmit`
- `npm test`（530 pass / 0 fail）
- `npm run docs:check`

## [1.0.0] - 2025-02-11

### Added
- **Message -> Safari 端到端能力**: Desktop Bridge 基础设施
  - `desktop.hotkey` - 发送快捷键（cmd+l, enter 等）
  - `desktop.typeText` - 通过剪贴板输入文本
  - `desktop.observe` - 截图 + AX 树证据落盘
  - `desktop.click` - 点击 UI 元素（需 confirm token）
  - `desktop.find` - 查找 UI 元素
  - `desktop.waitUntil` - 等待 UI 条件成立
  - `desktop.listModals` - 列出模态窗口
  - `desktop.dismissModal` - 关闭模态窗口
  - `desktop.abort` - 中止正在执行的请求
- LaunchAgent 支持：Mach Service 长期运行
- 测试钩子系统（`desktop._test.*`）：
  - `desktop._test.injectModalDetector` - 注入 mock modal 检测器
  - `desktop._test.clearModalDetector` - 清除 mock modal 检测器
- 安全机制：
  - Confirm Token 一次性确认
  - Allowlist 白名单验证
  - Evidence 证据强制落盘 workspace 内
  - Abort 中止能力
- 冒烟测试脚本：`scripts/desktop/smoke-message-safari.sh`

### Changed
- 架构变更：Bridge Server 从独立 XPC Service 改为内置 HostApp 进程
- TCC 权限检查现在指向 HostApp（com.msgcode.desktop.host）

### Security
- 测试钩子需要同时满足：
  1. 环境变量 `OPENCLAW_DESKTOP_TEST_HOOKS=1`
  2. 请求参数 `meta._testMode=true`
- LaunchAgent 支持通过 `install --test` 启用测试模式

### Testing
- 单元测试：417 个测试全部通过
- Safari E2E 冒烟测试验证通过
- 验收 executionId 示例（v1.0.0）：
  - hotkey cmd+l: `0F4C464C-6A5D-41FC-A780-1E7824BC4C4F`
  - typeText URL: `61DE7C34-D2F9-4715-AD23-14F9EBB0F832`
  - hotkey enter: `85B6A98B-5063-4BEA-B3F9-2FAA05784EA4`
  - observe: `E8D717C8-551F-4622-959B-E93C48B81744`

### Known Limitations
- macOS 仅（依赖 AXUIElement API）
- 需要辅助功能和屏幕录制权限
- Safari 以外的应用支持待验证
- 复杂 UI 场景（如多级菜单、动态内容）需进一步测试

### Documentation
- `docs/desktop/README.md` - Desktop Bridge API 文档
- `mac/MsgcodeDesktopHost/README.md` - HostApp 架构与使用
- `mac/MsgcodeDesktopHost/docs/desktop/README.md` - LaunchAgent 与测试钩子

[2.3.0]: https://github.com/yourorg/msgcode/releases/tag/v2.3.0
[1.0.0]: https://github.com/yourorg/msgcode/releases/tag/v1.0.0
