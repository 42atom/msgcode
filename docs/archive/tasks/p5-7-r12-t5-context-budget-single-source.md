# 任务单：P5.7-R12-T5（上下文预算单源化与跨后端一致性）

优先级：P1

## 目标（冻结）

1. 上下文预算口径单源化，避免分支路径漂移。  
2. 运行时探测优先，模型表兜底，环境变量覆盖最高优先级。  
3. 保持 `70% compact / 85% hard guard` 行为一致。

## 可行性依据（代码现状）

1. `src/capabilities.ts` 已实现“API 探测 + 模型表兜底 + env 覆盖”。  
2. `src/handlers.ts` 已接线预算观测与 compact。  
3. 风险点在于不同调用路径仍可能各自解析 provider/model，导致口径漂移。

## 范围（冻结）

涉及文件（预期）：

1. `/Users/admin/GitProjects/msgcode/src/capabilities.ts`
2. `/Users/admin/GitProjects/msgcode/src/handlers.ts`
3. `/Users/admin/GitProjects/msgcode/src/agent-backend/config.ts`
4. `/Users/admin/GitProjects/msgcode/test/p5-7-r12-t5-context-budget-single-source.test.ts`（新建）

## 范围外（冻结）

1. 不做 tokenizer 精算替换（仍采用近似估算）。  
2. 不更改 compact 文件格式（window/summary 保持现状）。  
3. 不引入新的模型路由策略。

## 设计约束（冻结）

1. 预算来源字段必须可观测：`source=env-override|api-models|model-table|provider-table|fallback`。  
2. provider/model 解析入口统一，禁止多处重复分支解析。  
3. 当 API 探测失败时必须稳定回退，不得抛出阻断异常。

## 实施步骤（每步一提交）

1. `refactor(p5.7-r12-t5): unify provider-model budget resolution entry`
   - 统一 `agent-backend` 与 `capabilities` 的 provider/model 解析
2. `feat(p5.7-r12-t5): lock budget source observability fields`
   - 日志中固定输出预算来源与关键阈值
3. `test(p5.7-r12-t5): add cross-backend budget consistency locks`
   - `local-openai/minimax/gemini/openai` 切换一致性
   - API 失败回退锁

## 验收门（冻结）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. 真实证据：
   - 切后端后预算字段与来源正确
   - 长会话触发 compact 仍按 70/85 阈值

## 依赖关系

1. 前置：R12-T3（verify 入链后，预算日志更有意义）  
2. 后置：R12-T6（preflight 可引用统一预算上下文）

## 风险与缓解

1. 风险：不同 provider API 格式变动导致探测失效  
   缓解：模型表兜底 + 缓存 + timeout。  
2. 风险：预算估算误差导致提前 compact  
   缓解：保持现有近似策略并保留可配置覆盖。
