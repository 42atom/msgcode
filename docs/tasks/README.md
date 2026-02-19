# 任务单索引（唯一时间线）

## 当前执行窗口（只看这一段）

1. `P5.6.8-R4h`：Tool Root 收口 + 失败防幻想（direct 主链止血）
2. `P5.6.10`：Runtime 硬化收口（Tool Bus 解耦 + 冷启动遥测 + 崩溃兜底）
3. `P5.6.10-R5`：终态运行时检验（三工作区 + 双管道）
4. `P5.6.13-R1`：本地语义记忆检索（sqlite-vec + FTS，停用 OV 方案）
5. `P5.6.13-R1A`：Tool Calling 架构调研（openclaw / pi-mono / msgcode 对照）
6. `P5.6.13-R2`：Workspace 对话落盘（`.msgcode/threads`）
7. `P5.6.14`：运行臂二分（agent/tmux）+ provider 下沉（专项）
8. `P5.7-PLAN`：CLI-First Skill 能力扩充总纲（对齐 Alma 使用模式）
9. `P5.7-R1`：CLI-First 文件发送先跑通（`help --json` + `file send`）

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

1. `P5.7-R1`：文件发送先跑通（`file send` + `help --json`）
2. `P5.7-R2`：实时信息三件套（`web search` / `web fetch` / `system info`）
3. `P5.7-R3`：文件管理能力（find/move/rename/zip）
4. `P5.7-R4`：记忆与线程检索（memory/thread）
5. `P5.7-R5`：任务编排（todo/schedule）
6. `P5.7-R6`：可视化取证与媒体辅助（screenshot/voice）
7. `P5.7-R7`：浏览器自动化（browser actions）
8. `P5.7-R8`：编码子代理委派（coding-agent）

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
- `p5-7-cli-first-skill-expansion-master-plan.md`：P5.7-PLAN（CLI-First Skill 能力扩充总纲）
- `p5-7-r1-cli-first-file-send.md`：P5.7-R1（CLI-First 文件发送先跑通，含后续能力扩充模板）

## 规则

- 任何插单只能是技术债，不得改变主线顺序。
- 每个任务结束必须提交并给出三门验收（`tsc` / `test` / `docs:check`）。
- 未签收任务不得进入下一阶段。
