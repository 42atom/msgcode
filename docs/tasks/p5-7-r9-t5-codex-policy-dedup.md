# 任务单：P5.7-R9-T5（CodexHandler 策略守卫去重）

优先级：P1（技术债收口，防回流）

## 背景

1. `CodexHandler` 中存在大量重复的 `tmux + local-only` 策略检查块。  
2. 重复分支会放大维护成本，且易出现“改一处漏多处”的回归风险。  
3. `RuntimeRouterHandler` 与 `CodexHandler` 的拒绝语义需保持单一真相源。

## 目标

1. 抽离单一策略守卫函数，统一拒绝文案与返回结构。  
2. 删除 `CodexHandler` 重复块，仅保留一次策略检查。  
3. 增加行为回归锁，防止重复块回流。

## 实施结果（已完成）

提交：`432a532`  
信息：`fix(p5.7-r9-t5): dedupe codex tmux policy guard`

变更：

1. `src/handlers.ts`
   - 新增 `resolveTmuxPolicyBlockResult(kind, mode)`  
   - `RuntimeRouterHandler` 改为复用守卫  
   - `CodexHandler` 去重（删除 200+ 行重复策略检查）
2. `test/p5-7-r9-t5-codex-policy-dedup.test.ts`
   - 新增 5 条行为锁测试（守卫语义 + 去重断言）

## 验收门

1. `npx tsc --noEmit` ✅
2. `npm test` ✅
3. `npm run docs:check` ✅

## 回归锁

1. `tmux + local-only` 必须拒绝  
2. `tmux + egress-allowed` 不拒绝  
3. `agent + local-only` 不拒绝  
4. `CodexHandler` 内 `resolveTmuxPolicyBlockResult` 仅出现一次  
5. `CodexHandler` 不再读取 `getTmuxClient` 进行策略判定

## 非范围

1. 不修改策略模型（仅去重实现）。  
2. 不调整 `/policy` 命令语义。  
3. 不改 tmux 发送链路。
