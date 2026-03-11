# 任务单：P5.7-R9-T2（上下文余量感知 + 70% 自动 Compact 主链）

优先级：P0（持续对话能力硬门）

## 背景结论（冻结）

1. 当前 `msgcode` 已有窗口/摘要/预算基础模块，但主链未完整打通“预算感知 -> 自动压缩 -> 持续可用”闭环。  
2. 现状是“可持久化但不主动控预算”：  
   - 会话窗口会落盘（`src/session-window.ts`），摘要也可读写（`src/summary.ts`）。  
   - 但预算能力（`src/budget.ts`、`src/capabilities.ts`）基本未进入请求主链决策。  
3. 这会导致长会话下上下文持续膨胀，出现“记忆看似在，实际逐步失效/丢失”的体验。

## 外部对标证据（冻结）

1. `pi-mono` 已做上下文压缩与双文件分层：  
   - `log.jsonl` 作为可检索长期记录，`context.jsonl` 作为 LLM 上下文。  
   - 参考：`/Users/admin/GitProjects/GithubDown/pi-mono/packages/mom/src/context.ts`。  
   - 运行期有 `auto_compaction_start/end` 事件。  
   - 参考：`/Users/admin/GitProjects/GithubDown/pi-mono/packages/mom/src/agent.ts`。  
2. `openclaw` 已做 context token 余量判定与 compact 触发链：  
   - 有预压缩 memory flush 与软阈值判断。  
   - 参考：`/Users/admin/GitProjects/GithubDown/openclaw/src/auto-reply/reply/memory-flush.ts`。  
   - 有显式 `/compact` 路径与压缩后 token 回写。  
   - 参考：`/Users/admin/GitProjects/GithubDown/openclaw/src/auto-reply/reply/commands-compact.ts`。

## 目标（冻结）

1. 一个 workspace 的对话在模型切换、进程重启后仍可延续（短期窗口 + 摘要可恢复）。  
2. 在请求发出前做上下文余量感知；当使用率达到 `70%` 时自动 compact。  
3. compact 后保证有可用余量，避免后续轮次直接爆窗。  
4. 所有路由（`no-tool/tool/complex-tool`）统一使用同一上下文资产，不再分支丢失。

## 设计口径（冻结）

1. **单一真相源（File-First）**：  
   - 短期：`<workspace>/.msgcode/sessions/<chatId>/window.jsonl`  
   - 历史压缩：`<workspace>/.msgcode/sessions/<chatId>/summary.md`  
2. **预算判定阈值**：  
   - 软阈值：`70%`（触发自动 compact）  
   - 硬保护：`85%`（compact 后仍超限则返回可诊断失败，不冒险继续）  
3. **compact 策略**：  
   - 保留最近窗口消息（recent turns）  
   - 将被裁剪历史提炼并并入 summary  
   - 重写窗口为“summary + recent”可继续运行的最小上下文  
4. **观测字段冻结**（日志必须带）：  
   - `contextWindowTokens`  
   - `contextUsedTokens`  
   - `contextUsagePct`  
   - `compactionTriggered`  
   - `compactionReason`

## 实施步骤（每步一提交）

1. `feat(p5.7-r9-t2): wire context budget sensing into request pipeline`  
   - 接线点：`src/handlers.ts`、`src/lmstudio.ts`  
   - 复用：`src/capabilities.ts`、`src/budget.ts`  
   - 输出每轮预算观测值（含百分比）

2. `feat(p5.7-r9-t2): add auto compact at 70 percent threshold`  
   - 接线点：`src/session-window.ts`、`src/summary.ts`、`src/handlers.ts`  
   - 增加“裁剪并写回”能力（不仅 slice，还要持久化落盘）  
   - compact 后再次评估使用率

3. `fix(p5.7-r9-t2): unify context injection across all routed paths`  
   - 接线点：`src/lmstudio.ts`  
   - 确保 `no-tool/tool/complex-tool` 均使用同一 `window + summary`

4. `test(p5.7-r9-t2): add context budget and compaction regression locks`  
   - 新增测试：`test/p5-7-r9-t2-context-budget-compact.test.ts`  
   - 锁点：70%触发、85%保护、重启后恢复、换模型后恢复、路由一致性

5. `test(p5.7-r9-t2): add real smoke for long-chat continuity`  
   - 新增脚本：`scripts/r9-context-compact-smoke.ts`  
   - 输出证据：`AIDOCS/reports/r9-context-compact-smoke-*.md/json`

## 验收门（冻结）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 真实长会话冒烟：连续多轮后可继续回复，且有 compact 证据
5. 重点场景必须 PASS：
   - 应用重启后继续对话不丢短期记忆
   - 切换模型后仍可读到同一 workspace 会话资产

## 失败分类（冻结）

1. `CONTEXT_BUDGET_MISSED`：预算计算未生效或日志缺失  
2. `CONTEXT_COMPACTION_FAILED`：触发后压缩失败  
3. `CONTEXT_OVERFLOW_PROTECTED`：超过硬阈值被保护性拒绝  
4. `CONTEXT_STATE_DRIFT`：重启/换模后上下文资产漂移

## 非范围

1. 不改工具协议语义（tool loop 行为保持现有合同）。  
2. 不引入新数据库存储（保持 File-First）。  
3. 不在本单引入额外后端或新模型。

