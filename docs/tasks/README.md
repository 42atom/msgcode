# 任务单索引（唯一时间线）

## P5.6 归档状态

1. `P5.6` 系列状态：`CLOSED`（2026-02-20）
2. 归档说明：`p5-6-archive-closure-note.md`
3. 新能力扩展统一转入 `P5.7` 系列执行

## 当前执行窗口（只看这一段）

1. `P5.6.8-R4h`：Tool Root 收口 + 失败防幻想（direct 主链止血）
2. `P5.6.10`：Runtime 硬化收口（Tool Bus 解耦 + 冷启动遥测 + 崩溃兜底）
3. `P5.6.10-R5`：终态运行时检验（三工作区 + 双管道）
4. `P5.6.13-R1`：本地语义记忆检索（sqlite-vec + FTS，停用 OV 方案）
5. `P5.6.13-R1A`：Tool Calling 架构调研（openclaw / pi-mono / msgcode 对照）
6. `P5.6.13-R2`：Workspace 对话落盘（`.msgcode/threads`）
7. `P5.6.14`：运行臂二分（agent/tmux）+ provider 下沉（专项）
8. `P5.7-PLAN`：CLI-First Skill 能力扩充总纲（Unix 风格 CLI，Alma 仅作参考样例）
9. `P5.7-R1`：CLI-First 文件发送先跑通（`help-docs --json` + `file send`，合同层）
10. `P5.7-R2`：实时信息三件套（`web search` / `web fetch` / `system info`）
11. `P5.7-R1b`：文件发送真实交付闭环（禁止“合同壳即通过”）
12. `P5.7-R1c`：CLI 基座能力硬门（真执行 + 可观测 + 安全底线）
13. `P5.7-R3`：文件与环境域（`file *` + `system env`）
14. `P5.7-R3l`：核心链路硬化改造包（三核最小实现 + 协议硬门 + 状态回写）
15. `P5.7-R4`：记忆与线程域（`memory *` + `thread *`）
16. `P5.7-R5`：编排与调度域（`todo *` + `schedule *`）
17. `P5.7-R6`：多模态域（`media *` + `gen *`）
18. `P5.7-R7`：浏览器域（`browser *`）
19. `P5.7-R7B`：Gmail 只读验收（首条真实浏览器业务流）
20. `P5.7-R7C`：非默认 Chrome 数据根 + CDP 验证
19. `P5.7-R8`：代理域（`agent run/status`）
20. `P5.7-R8b`：Agent Backend 语义收敛与 MiniMax 2.5 切换（`lmstudio` -> `agent-backend`）
21. `P5.7-R8d`：模型切换全链路同步（后端模型单源绑定）
22. `P5.7-R9`：模型真实能力验收门（文件查看/自拍编排/定时提醒/记忆/任务管理）
23. `P5.7-R9-T1`：真实能力验收执行单（Opus 主执行 + Codex 复核）
24. `P5.7-R9-T2`：上下文余量感知与 70% 自动 Compact 主链（长会话持续能力硬门）
25. `P5.7-R9-T3`：记忆默认开启 + PI 基线对齐 + 分支收敛（防回退）
26. `P5.7-R9-T4`：`lmstudio` 命名去耦到 `agent-backend`（高风险重命名专单）
27. `P5.7-R9-T5`：CodexHandler 策略守卫去重（主链反复 if/else 收敛）
28. `P5.7-R9-T6`：`lmstudio` 硬编码语义清理（配置/路由/类型主语收敛）
29. `P5.7-R9-T7`：`lmstudio.ts` 兼容壳化与 agent-backend 核心拆分
30. `P5.7-R9-T8`：仓库文档协议目录对齐（issues/design/notes/adr/changelog）
31. `P5.7-R10`：可用性稳定化派单包（memory/thread/gen image 可用性阻断收口）
32. `P5.7-R10-1`：memory 零手工索引召回（add 后可直接 search）
33. `P5.7-R10-2`：thread workspace 作用域一致性（补齐 `--workspace`）
34. `P5.7-R10-3`：gen image 提供方降级与诊断（区域限制可恢复）
35. `P5.7-R11`：无子代理执行框架落地（单代理阶段机 + 先读后改 + 先验后交）
36. `P5.7-R12`：硬前提补齐派单包（常驻唤醒/调度自愈/verify/队列持久化/预算统一/secrets 单源/模型服务生命周期）
37. `P5.7-R12-T1`：Heartbeat 常驻唤醒与事件唤醒底座
38. `P5.7-R12-T2`：Scheduler 自愈与热加载（去 `/reload` 依赖）
39. `P5.7-R12-T3`：`verify` 阶段入主链（plan->act->verify->report）
40. `P5.7-R12-T4`：事件队列持久化与重启恢复
41. `P5.7-R12-T5`：上下文预算单源化与跨后端一致性
42. `P5.7-R12-T6`：Secrets 单源化与 preflight 闭环
43. `P5.7-R12-T7`：Whisper/本地模型服务空闲 10 分钟释放策略与验收

## P5 当前唯一执行主线（冻结）

1. `P5.4-R2`：Autonomous Skill 默认主路径收敛（自然语言触发优先）
2. `P5.5`：Skill 编排主线收敛（LLM 决策 + tool_calls）
3. `P5.6.1`：运行时内核收敛（`handlers` 只做路由/编排入口）
4. `P5.6.2`：模型执行层三分（协议适配 / tool loop / 输出清洗）
5. `P5.6.2-R1`：后置回归修复（ToolLoop 主链 + `/reload` SOUL + 记忆链路）
6. `P5.6.3`：Skill 执行单一真相源（执行路径统一）
7. `P5.6.4`：状态域边界化（window/pending/memory，`/clear` 只清短期）
8. `P5.6.5`：命令层最终瘦身（`commands.ts` 只留注册+分发+fallback）
9. `P5.6.6`：测试 DI 化与回归锁固化

## P5 后续排队（前置主线完成后再启用）

10. `P5.6.7`：双管道契约锁定 + 三工作区集成冒烟（`medicpass/charai/game01`）
11. `P5.6.7-R9`：P0 插单（SOUL 路径与注入闭环、窗口读链路接线）
12. `P5.6.8-R1`：短期记忆窗口读链路闭环（ToolLoop 真接线）
13. `P5.6.8-R2`：长期记忆注入自动化闭环（不依赖纯 CLI 手工）
14. `P5.6.8-R3`：PI 开关语义收敛（off=普通聊天+记忆，on=Pi 核心循环+四基础工具+skill 索引提示）
15. `P5.6.8-R3e`：遗留硬切（删除 `/skill run`、`run_skill`、旧工具名）
16. `P5.6.8-PLAN`：Pi 文章能力对齐总控计划（R3 内核切换 → R4 SOUL/记忆闭环 → R5 skill 去耦 → R6 回归锁）
17. `P5.6.8-R4a`：SOUL 运行时真读取闭环（workspace/global 优先级 + `/reload` 真回执）
18. `P5.6.8-R4b`：短期记忆窗口接入 Pi Tool Loop（window/summary 真接线）
19. `P5.6.8-R4c`：长期记忆注入稳态化与可观测收口
20. `P5.6.8-R4d`：三工作区运行时冒烟验收（`medicpass/charai/game01`）
21. `P5.6.8-R4e`：PI on/off 提示词与工具硬门一致性收口
22. `P5.6.8-R5a`：artifact→send 回传桥接（发送保持内核能力，不进入 skill）
23. `P5.6.8-R4f`：日志文本格式化去重（`inboundText/responseText` 单一 helper）
24. `P5.6.9`：CLI 执行层收口（Command Runner + Validator + 契约锁）
25. `P5.6.10`：Runtime 硬化收口（Tool Bus 解耦 + 冷启动遥测 + 崩溃兜底）
26. `P5.6.8-R4g`：PI 核心四工具可用性收口（`bash/shell` 门禁漂移修复）
27. `P5.6.9-R4`：CLI 回归锁口径收敛（清退过期锁 + Gate 复绿）
28. `P5.6.8-R4g-R1`：`bash/shell` 类型与门禁硬收口（类型错误与运行时漂移止血）

## P5.7 系列（CLI-First 能力扩充）

### 基座硬门（P5.7-R1c 冻结）

1. **基座边界**：`msgcode` 只提供 CLI 能力，不实现 skill 编排/模型策略
2. **能力硬门**：新增命令必须满足
   - 命令语义 = 真实行为（如 `send` 必须真发送）
   - 至少 1 条真实成功证据（非 mock）
   - 至少 1 条真实失败证据（非 mock，错误码可断言）
   - `help-docs --json` 必须可发现命令合同
   - 错误码必须固定枚举，退出码非 0 表示失败
3. **安全底线**：
   - 禁止静默副作用（关键操作必须显式参数触发）
   - 禁止"伪成功"（失败必须返回非 0 退出码）
   - 破坏性操作必须 `--force` 显式确认

### 任务列表

1. `P5.7-R1`：文件发送先跑通（`file send` + `help-docs --json`）✅
2. `P5.7-R2`：实时信息三件套（`web search` / `web fetch` / `system info`）✅
3. `P5.7-R1b`：文件发送真实交付闭环（`--to` + 真发送 + 真失败）✅
4. `P5.7-R1c`：CLI 基座能力硬门（真执行 + 可观测 + 安全底线）✅
5. `P5.7-R3`：文件与环境域（`file find/read/write/move/rename/delete/copy/zip` + `system env`）
6. `P5.7-R3d`：LM Studio GLM ToolCall 温度锁定（`temperature=0`）
7. `P5.7-R3l`：核心链路硬化改造包（先稳主链：协议硬门/三核管道/action_journal/观测锁）
8. `P5.7-R4`：记忆与线程域（`memory search/add/stats` + `thread list/messages/active/switch`）
9. `P5.7-R5`：编排与调度域（`todo add/list/done` + `schedule add/list/remove`）✅
10. `P5.7-R5b`：Job/Schedule 读模型统一（schedule 写入后同步 jobs.json，写隔离读统一）
11. `P5.7-R5c`：回头优化（File-First 状态收敛：`md/json/yml` 为真相源，DB 仅记忆索引）
12. `P5.7-R6`：多模态域（`media screen` + `gen image/selfie/tts/music`）
13. `P5.7-R7`：浏览器域（`browser open/click/type`）
14. `P5.7-R8`：代理域（`agent run/status`）
15. `P5.7-R8b`：Agent Backend 切换（`agent-backend/local-openai/minimax`）
16. `P5.7-R8d`：模型切换全链路同步（切换即全链路同模）
17. `P5.7-R9`：真实能力验收门（8 项真实场景 + 三重点指标）
18. `P5.7-R9-T1`：真实能力验收执行单（真机跑测 + 证据回填 + 阻断修复）
19. `P5.7-R9-T2`：上下文余量感知与自动 Compact（70% 触发 + 重启/换模续聊）
20. `P5.7-R9-T3`：记忆默认开启与 /clear 边界锁（PI 基线 + 收敛分支）
21. `P5.7-R9-T4`：后端中性命名重构（文件/函数/文案从 lmstudio 收敛为 agent-backend）
22. `P5.7-R9-T5`：CodexHandler 策略守卫去重（消除重复块 + 单一守卫函数）
23. `P5.7-R9-T6`：lmstudio 硬编码语义清理（配置/路由/类型主语收敛）
24. `P5.7-R9-T7`：agent-backend 核心拆分（`lmstudio.ts` 降级为兼容壳）
25. `P5.7-R9-T8`：CLAUDE 文档协议目录对齐（目录 + 模板 + docs:check）
26. `P5.7-R10`：可用性稳定化派单包（真实冒烟阻断收口）
27. `P5.7-R10-1`：memory 零手工索引召回（`add -> search` 可直接命中）
28. `P5.7-R10-2`：thread workspace 作用域一致性（参数与行为对齐）
29. `P5.7-R10-3`：gen image 提供方降级与诊断（主备切换 + 错误码）
30. `P5.7-R11`：无子代理执行框架落地（规则提炼 + 阶段机 + 验证策略）
31. `P5.7-R12`：硬前提补齐派单包（连续运行、可验证交付、配置单源）
32. `P5.7-R12-T1`：Heartbeat 常驻唤醒与事件唤醒底座
33. `P5.7-R12-T2`：Scheduler 自愈与热加载
34. `P5.7-R12-T3`：`verify` 阶段入主链
35. `P5.7-R12-T4`：事件队列持久化与重启恢复
36. `P5.7-R12-T5`：上下文预算单源化与跨后端一致性
37. `P5.7-R12-T6`：Secrets 单源化与 preflight 闭环
38. `P5.7-R12-T7`：Whisper/本地模型服务生命周期验收与 10 分钟空闲释放

### 派单顺序（冻结）

1. `P5.7-R3`（file 域）
2. `P5.7-R3d`（LM Studio GLM ToolCall 温度锁定，稳定性插单）
3. `P5.7-R3l`（核心链路硬化：协议硬门 + 三核最小管道）
4. `P5.7-R4`（memory/thread 域）
5. `P5.7-R5`（todo/schedule 域）
6. `P5.7-R6`（media/gen 域）
7. `P5.7-R7`（browser 域）
8. `P5.7-R8`（agent 域）
9. `P5.7-R8b`（agent backend 切换与语义收敛）

## 当前任务单

- `p5-5-skill-orchestration-toolcalls.md`：P5.5（按最新冻结口径执行）
- `p5-6-1-runtime-kernel-convergence.md`：P5.6.1（运行时内核收敛）
- `p5-6-1-r2a-persona-residue-cleanup.md`：P5.6.1-R2A（persona 残留清理）
- `p5-6-1-r2b-root-slim-pr-checklist.md`：P5.6.1-R2B（根目录瘦身）
- `p5-6-1-r3-mlx-final-retirement.md`：P5.6.1-R3（MLX 最终退役）
- `p5-6-2-r1-postfix-toolloop-reload-soul.md`：P5.6.2-R1（回归修复）
- `p5-6-2-r4b2-lmstudio-slim.md`：P5.6.2-R4b2（lmstudio.ts 继续瘦身）
- `p5-6-2-p0-soul-minimal-extract.md`：P5.6.2-P0（SOUL 修复最小摘取）
- `p5-6-2-r5-branch-consolidation.md`：P5.6.2-R5（分支收口与主线归并计划）
- `p5-6-3-skill-single-source.md`：P5.6.3（Skill 执行单一真相源）
- `p5-6-4-r0a-pipeline-boundary-audit.md`：P5.6.4-R0A（双管道边界审计检查单）
- `p5-6-5-command-layer-final-slim.md`：P5.6.5（命令层最终瘦身）
- `p5-6-7-r6-smoke-checklist.md`：P5.6.7-R6（集成冒烟清单）
- `p5-6-7-r9-soul-memory-mainline-insert.md`：P5.6.7-R9（SOUL/记忆 P0 插单）
- `p5-6-8-memory-soul-closure.md`：P5.6.8（记忆与 SOUL 主链闭环）
- `p5-6-8-r3-pi-core-switch.md`：P5.6.8-R3（PI on/off 语义与四基础工具收敛）
- `p5-6-8-r3abc-toolchain-convergence.md`：P5.6.8-R3ABC（Tool 链路收敛派发单）
- `p5-6-8-r3e-legacy-hard-cut.md`：P5.6.8-R3e（历史兼容壳硬切）
- `p5-6-8-pi-article-full-implementation-plan.md`：P5.6.8 总控（Pi 文章能力对齐完整开发计划）
- `p5-6-8-r4a-soul-runtime-read.md`：P5.6.8-R4a（SOUL 真读取与 `/reload` 口径修正）
- `p5-6-8-r4b-short-memory-window-loop.md`：P5.6.8-R4b（短期窗口/摘要接入 Tool Loop）
- `p5-6-8-r4c-long-memory-injection-observability.md`：P5.6.8-R4c（长期记忆注入稳态与观测锁）
- `p5-6-8-r4d-three-workspace-runtime-smoke.md`：P5.6.8-R4d（三工作区运行时冒烟）
- `p5-6-8-r4e-pi-on-off-prompt-tooling-alignment.md`：P5.6.8-R4e（PI on/off 提示词与工具双保险收口）
- `p5-6-8-r4f-log-text-format-helper.md`：P5.6.8-R4f（日志文本转义与截断逻辑去重）
- `p5-6-8-r4g-pi-core-tools-gate-alignment.md`：P5.6.8-R4g（PI 四工具门禁与命名收口，确保 `bash pwd` 真实执行）
- `p5-6-8-r4g-r1-bash-shell-hard-closure.md`：P5.6.8-R4g-R1（`bash/shell` 类型与配置口径一次性收口）
- `p5-6-8-r4h-tool-root-fail-fantasy-fix.md`：P5.6.8-R4h（ToolLoop 根路径单一真相 + 工具失败防幻想）
- `p5-6-8-r5a-artifact-send-bridge.md`：P5.6.8-R5a（artifact 到发送通道桥接）
- `p5-6-9-cli-command-runner-convergence.md`：P5.6.9（CLI 命令执行层收口）
- `p5-6-9-r4-regression-lock-alignment.md`：P5.6.9-R4（清退过期回归锁，恢复全量 Gate 可信）
- `p5-6-10-runtime-hardening-from-review-v2.md`：P5.6.10（审查 v2 的 Runtime 硬化响应单）
- `p5-6-10-r5-runtime-final-validation.md`：P5.6.10-R5（终态运行时检验与签收）
- `p5-6-10-r6-pi-mono-benchmark-and-adoption.md`：P5.6.10-R6（pi-mono 三包对照评审与落地参考）
- `p5-6-13-r1-sqlite-vec-local-semantic-memory.md`：P5.6.13-R1（sqlite-vec 本地语义记忆检索）
- `p5-6-13-r1a-toolcall-architecture-research.md`：P5.6.13-R1A（Tool Calling 架构调研与实施建议）
- `p5-6-13-r1a-exec-toolloop-contract-convergence.md`：P5.6.13-R1A-EXEC（ToolLoop 契约收口执行单）
- `p5-6-13-r2-workspace-threads-persistence.md`：P5.6.13-R2（按 workspace 落盘会话线程）
- `p5-6-14-agent-tmux-runtime-bifurcation.md`：P5.6.14（运行臂二分与 provider 下沉专项）
- `p5-6-archive-closure-note.md`：P5.6 归档说明（主线完成，转入 P5.7）
- `p5-7-cli-first-skill-expansion-master-plan.md`：P5.7-PLAN（CLI-First Skill 能力扩充总纲）
- `p5-7-r1-cli-first-file-send.md`：P5.7-R1（CLI-First 文件发送先跑通，含后续能力扩充模板）
- `p5-7-r2-realtime-info-triad.md`：P5.7-R2（实时信息三件套任务单）
- `p5-7-r1b-file-send-real-delivery.md`：P5.7-R1b（文件发送真实交付闭环，禁止合同壳验收）
- `p5-7-r1c-cli-substrate-capability-baseline.md`：P5.7-R1c（CLI 基座能力硬门任务单）
- `p5-7-r3-r8-mainline-dispatch-pack.md`：P5.7-R3~R8 总整理与派单包
- `p5-7-r3-file-system-domain.md`：P5.7-R3（文件与环境域任务单）
- `p5-7-r4-mainline-dispatch-pack.md`：P5.7-R4 总整理与派单包（memory/thread 分步执行）
- `p5-7-r4-memory-thread-domain.md`：P5.7-R4（记忆与线程域任务单）
- `p5-7-r4-1-memory-contract.md`：P5.7-R4-1（memory 命令合同收口）
- `p5-7-r4-2-thread-contract.md`：P5.7-R4-2（thread 命令与 active 强确认）
- `p5-7-r4-3-help-regression-lock.md`：P5.7-R4-3（help-docs 同步与回归锁）
- `p5-7-r4-t1-smoke-verification-gate.md`：P5.7-R4-T1（Memory/Thread 真机冒烟门禁）
- `p5-7-r5-mainline-dispatch-pack.md`：P5.7-R5 总整理与派单包（todo/schedule 分步执行）
- `p5-7-r5-todo-schedule-domain.md`：P5.7-R5（编排与调度域任务单）
- `p5-7-r5-1-todo-contract.md`：P5.7-R5-1（todo 命令合同收口）✅
- `p5-7-r5-2-schedule-contract.md`：P5.7-R5-2（schedule 命令合同收口）✅
- `p5-7-r5-3-help-regression-lock.md`：P5.7-R5-3（help-docs 同步与回归锁）✅
- `p5-7-r5b-job-schedule-read-model-unification.md`：P5.7-R5b（Job/Schedule 读模型统一）
- `p5-7-r5c-file-first-state-refactor.md`：P5.7-R5c（回头优化：File-First 状态收敛，DB 仅记忆索引）
- `p5-7-r6-media-gen-domain.md`：P5.7-R6（多模态域任务单）
- `p5-7-r6b-image-read-lmstudio-lifecycle.md`：P5.7-R6b（`image read` + LM Studio 按需加载/1h 自动卸载）
- `p5-7-r7-browser-domain.md`：P5.7-R7（浏览器域任务单）
- `p5-7-r7b-gmail-readonly-acceptance.md`：P5.7-R7B（Gmail 只读验收）
- `p5-7-r7c-nondefault-chrome-root-cdp.md`：P5.7-R7C（非默认 Chrome 数据根 + CDP 验证）
- `p5-7-r8-agent-domain.md`：P5.7-R8（代理域任务单）
- `p5-7-r8b-agent-backend-switch-minimax-2-5.md`：P5.7-R8b（Agent Backend 切换与 `lmstudio` 语义退场）
- `p5-7-r8d-model-switch-chain-sync.md`：P5.7-R8d（后端模型切换全链路同步，单源绑定）
- `p5-7-r9-real-capability-gate.md`：P5.7-R9（模型真实能力验收门，能力扩展前置硬门）
- `p5-7-r9-t1-real-capability-execution-dispatch.md`：P5.7-R9-T1（Opus 并行执行单：真机跑测 + 证据 + 最小修复）
- `p5-7-r9-t2-context-budget-auto-compact.md`：P5.7-R9-T2（上下文预算感知 + 70% 自动 Compact + 持续对话）
- `p5-7-r9-t3-memory-default-on-pi-baseline-and-branch-convergence.md`：P5.7-R9-T3（记忆默认开启 + /clear 边界 + PI 基线 + 分支收敛）
- `p5-7-r9-t4-agent-backend-neutral-naming-refactor.md`：P5.7-R9-T4（`lmstudio` 命名去耦，统一 `agent-backend` 主语）
- `p5-7-r9-t5-codex-policy-dedup.md`：P5.7-R9-T5（CodexHandler 策略守卫去重与回归锁）
- `p5-7-r9-t6-lmstudio-hardcode-purge.md`：P5.7-R9-T6（`lmstudio` 硬编码语义清理专项）
- `p5-7-r9-t7-agent-backend-core-extraction.md`：P5.7-R9-T7（`lmstudio.ts` 兼容壳化 + agent-backend 核心拆分）
- `p5-7-r9-t8-repo-protocol-alignment.md`：P5.7-R9-T8（CLAUDE 协议目录落地与兼容迁移）
- `p5-7-r10-usability-stabilization-pack.md`：P5.7-R10（可用性稳定化派单包）
- `p5-7-r10-1-memory-zero-touch-recall.md`：P5.7-R10-1（memory 零手工索引召回）
- `p5-7-r10-2-thread-workspace-scope-parity.md`：P5.7-R10-2（thread workspace 作用域一致性）
- `p5-7-r10-3-gen-image-provider-fallback-diagnostics.md`：P5.7-R10-3（gen image 提供方降级与诊断）
- `p5-7-r11-no-subagent-execution-playbook.md`：P5.7-R11（无子代理执行框架落地）
- `p5-7-r12-hard-prerequisites-dispatch-pack.md`：P5.7-R12（硬前提补齐派单包）
- `p5-7-r12-t1-heartbeat-event-wake.md`：P5.7-R12-T1（Heartbeat 常驻唤醒与事件唤醒底座）
- `p5-7-r12-t1-heartbeat-event-wake-dispatch.md`：P5.7-R12-T1 派单执行单（Opus）
- `p5-7-r12-t2-scheduler-self-heal-hot-reload.md`：P5.7-R12-T2（Scheduler 自愈与热加载）
- `p5-7-r12-t2-scheduler-self-heal-hot-reload-dispatch.md`：P5.7-R12-T2 派单执行单（Opus）
- `p5-7-r12-t3-verify-phase-mainline.md`：P5.7-R12-T3（`verify` 阶段入主链）
- `p5-7-r12-t4-event-queue-persistence.md`：P5.7-R12-T4（事件队列持久化与重启恢复）
- `p5-7-r12-t5-context-budget-single-source.md`：P5.7-R12-T5（上下文预算单源化）
- `p5-7-r12-t6-secrets-single-source-preflight.md`：P5.7-R12-T6（Secrets 单源化与 preflight 闭环）
- `p5-7-r12-t7-model-service-idle-release.md`：P5.7-R12-T7（Whisper/本地模型服务生命周期验收与 10 分钟空闲释放）
- `p5-7-r3d-lmstudio-glm-toolcall-temperature-lock.md`：P5.7-R3d（LM Studio GLM ToolCall 温度锁定）
- `p5-7-r3f-r3k-tool-loop-best-practice-pack.md`：P5.7-R3f~R3k（Tool Loop 最佳实践改造派单包）
- `p5-7-r3f-bash-runner-engineering.md`：P5.7-R3f（Bash Runner 工程化）
- `p5-7-r3g-tool-loop-multi-call-closure.md`：P5.7-R3g（Tool Loop 多工具闭环）
- `p5-7-r3h-tool-failure-contract-diagnostics.md`：P5.7-R3h（工具失败合同与诊断增强）
- `p5-7-r3i-fs-scope-policy-layering.md`：P5.7-R3i（文件权限策略分层）
- `p5-7-r3j-dual-model-routing-stabilization.md`：P5.7-R3j（双模型路由稳定化）
- `p5-7-r3k-tool-loop-slo-gate.md`：P5.7-R3k（Tool Loop SLO 门禁落地）
- `p5-7-r3l-core-chain-hardening-pack.md`：P5.7-R3l（核心链路硬化改造包）
- `p5-7-r3l-1-tool-protocol-hard-gate.md`：P5.7-R3l-1（tool 协议硬门：无 tool_calls 禁伪执行）
- `p5-7-r3l-2-dialog-exec-prompt-split.md`：P5.7-R3l-2（Dialog/Exec 提示词边界拆分）
- `p5-7-r3l-3-plan-act-report-pipeline.md`：P5.7-R3l-3（Plan->Act->Report 三阶段管道）
- `p5-7-r3l-4-action-journal-state-sync.md`：P5.7-R3l-4（action_journal 状态回写契约）
- `p5-7-r3l-5-ttft-observability-lock.md`：P5.7-R3l-5（TTFT 补偿与观测字段锁）
- `p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.md`：P5.7-R3l-7（tool_calls 重试 + SOUL 路径纠偏）

## 规则

- 任何插单只能是技术债，不得改变主线顺序。
- 每个任务结束必须提交并给出三门验收（`tsc` / `test` / `docs:check`）。
- 未签收任务不得进入下一阶段。
