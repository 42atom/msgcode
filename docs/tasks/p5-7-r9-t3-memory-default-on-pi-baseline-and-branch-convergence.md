# 任务单：P5.7-R9-T3（记忆默认开启 + PI 基线对齐 + 分支收敛）

优先级：P0（R9-T2 并行前置约束）

## 选型结论（冻结）

在 `pi-mono` 与 `openclaw` 中，**本单选择 `pi-mono` 作为主学习基线**。

理由（工程落地优先）：

1. 架构更贴近“Claude Code 风格持续会话”：`log.jsonl`（长期）+ `context.jsonl`（工作上下文）。  
2. 语义更简：默认持续记忆，只有明确清理才重置。  
3. 对当前 `msgcode` 改造成本更低，避免一次性引入 `openclaw` 级别复杂补偿链。

对标文件：

1. `/Users/admin/GitProjects/GithubDown/pi-mono/packages/mom/src/context.ts`
2. `/Users/admin/GitProjects/GithubDown/pi-mono/packages/mom/src/agent.ts`

## 需求冻结（C兄口径）

1. 记忆能力默认打开（无需手动开关）。  
2. 每次对话都带上上下文（直到触发摘要）；禁止提前摘要。  
3. `/clear` 才清空短期会话上下文；未执行 `/clear` 时，重启/切模后仍可续聊。  
4. 长期记忆（memory）与短期窗口（window/summary）分层存在，不互相误清。  
5. 系统提示词必须文件化，允许直接编辑，不再依赖代码硬编码调参。

## 系统提示词文件位置（当前实现）

1. 默认文件：`/Users/admin/GitProjects/msgcode/prompts/lmstudio-system.md`  
2. 可覆写环境变量：`LMSTUDIO_SYSTEM_PROMPT_FILE`  
3. 加载入口：`/Users/admin/GitProjects/msgcode/src/lmstudio.ts`（`DEFAULT_LMSTUDIO_SYSTEM_PROMPT_FILE` / `resolveBaseSystemPrompt`）

## 实施步骤（每步一提交）

1. `feat(p5.7-r9-t3): enforce memory-default-on session policy`  
   - 统一策略：请求前必读 `window + summary`，请求后必写回  
   - 禁止“路由分支漏写回/漏注入”

2. `fix(p5.7-r9-t3): harden clear semantics to short-term only`  
   - `/clear` 仅清 `window + summary`  
   - 长期 memory 不清理  
   - 增加显式日志：`clearScope=short-term`

3. `feat(p5.7-r9-t3): delay summary until budget threshold`  
   - 依赖 `R9-T2` 预算链  
   - 低于阈值只累积窗口，不生成摘要  
   - 阈值触发后才 compact + summary

4. `refactor(p5.7-r9-t3): promote system prompt to editable agent prompt contract`  
   - 约定主文件仍为 `prompts/lmstudio-system.md`（兼容现有）  
   - 增加文档化编辑说明与 reload 流程（可热改）

5. `test(p5.7-r9-t3): add memory persistence and clear-boundary locks`  
   - 重启续聊锁  
   - 切模续聊锁  
   - `/clear` 边界锁  
   - 提前摘要禁止锁

## 分支收敛方案（冻结）

目标：降低“多分支漂移 -> 回退”风险，建立单主干收敛节奏。

1. 收敛分支：`codex/p5-7-r9-mainline-convergence`  
2. 规则：
   - 不直接在历史任务分支叠改
   - 只从“已签收提交”按顺序 cherry-pick
   - 每 3~5 个提交跑一次三门
3. 顺序（建议）：
   - 先 `R8b/R8d`（后端与模型单源）
   - 再 `R3l`（核心链路硬化）
   - 再 `R9-T2/T3`（持续会话能力）
4. 保护：
   - 收敛分支禁止 `git add -A`
   - 每次冲突处理后必须跑 `npm test`
   - 收敛结束后出一份 `AIDOCS/reports/r9-mainline-convergence.md`

## 验收门（冻结）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 真实验收：
   - 同 workspace 连续对话不丢上下文  
   - 重启后能续上最近会话  
   - 切模型后仍能续上同会话  
   - 仅 `/clear` 才清短期会话

## 非范围

1. 不在本单引入新后端。  
2. 不改变工具协议合同。  
3. 不改长期 memory 索引实现（只校正边界与接线）。

