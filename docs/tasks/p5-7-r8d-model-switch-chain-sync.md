# 任务单：P5.7-R8d（模型切换全链路同步）

优先级：P0（主链稳定性）

## 目标（冻结）

1. 一旦后端模型切换生效（`AGENT_MODEL` 或后端专属模型变量），分类器与执行链路必须使用同一模型。
2. 禁止“切换后只影响部分链路”的遗漏（例如分类器仍用旧模型、tool/no-tool 分叉）。
3. 保持既有路由/温度契约不变，仅修正模型绑定策略。

## 问题背景

1. 现有链路中，`executorModel` 与 `responderModel` 允许来自 workspace 配置。
2. 当全局后端模型切换后，若 workspace 仍有旧值，可能出现链路模型不一致。
3. 结果是：分类、no-tool、tool/complex-tool 可能“看起来切了，实际未全切”。

## 设计口径（冻结）

1. **单源优先**：若后端运行时模型已配置（`AGENT_MODEL/MINIMAX_MODEL/OPENAI_MODEL/LMSTUDIO_MODEL`），全链路统一该模型。
2. **回退策略**：仅在后端模型未配置时，才使用 workspace 双模型（`model.executor/model.responder`）。
3. **可观测性**：日志新增 `modelBindingMode`，取值：
   - `backend-single-source`
   - `workspace-dual-model`

## 实施改动

1. 文件：`src/lmstudio.ts`
   - 在 `runLmStudioRoutedChat` 开始阶段新增 `backendPinnedModel` 绑定逻辑。
   - 后端模型存在时强制：
     - `executorModel = backendPinnedModel`
     - `responderModel = backendPinnedModel`
   - 日志字段新增 `modelBindingMode`。
2. 文件：`test/p5-7-r8d-model-switch-chain-sync.test.ts`
   - 新增回归锁：
     - workspace 内强行写入不同 `model.executor/model.responder`
     - 全局设 `MINIMAX_MODEL=minimax-chain-sync-model`
     - 断言分类请求与主回答请求都命中同一模型
     - 断言不会落到 workspace 旧模型

## 验收门

1. `npx tsc --noEmit`：PASS
2. `npm run docs:check`：PASS
3. 关键回归：
   - `test/p5-7-r8d-model-switch-chain-sync.test.ts`：PASS
   - `test/p5-7-r8c-agent-backend-single-source.test.ts`：PASS
   - `test/p5-7-r3e-dual-model-routing.test.ts`：PASS
   - `test/p5-7-r3l-1-tool-protocol-hard-gate.test.ts`：PASS

## 风险与边界

1. 该策略会在“后端模型已配置”时覆盖 workspace 双模型，属于有意设计，保证“切换即全切”。
2. 若未来需要恢复“按路由不同模型”，应以显式开关实现，不要隐式混用单源与双源。

## 回滚策略

1. 取消后端模型配置（清空 `AGENT_MODEL`/后端专属模型变量），链路将自动回退到 workspace 双模型模式。
2. 或直接回退本单代码变更（`src/lmstudio.ts`）。
