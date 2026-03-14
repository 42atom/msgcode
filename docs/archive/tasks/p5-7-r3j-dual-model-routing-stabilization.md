# 任务单：P5.7-R3j（双模型路由稳定化）

优先级：P1（在工具链稳定后执行）

## 目标（冻结）

1. 固化双模型职责：
   - `executor`：工具调用链路
   - `responder`：纯对话回复链路
2. 固化温度策略：
   - tool/complex-tool：`temperature=0`
   - no-tool：`temperature=0.2`
3. 增强路由可观测性，避免“计算了温度但未生效”回归。

## 范围

- `src/lmstudio.ts`
- `src/routing/classifier.ts`
- `src/config/workspace.ts`
- `test/*p5-7-r3j*.test.ts`（新增）

## 非范围

1. 不改 Tool Bus 执行器。
2. 不改 SLO 指标阈值（R3k 处理）。
3. 不新增模型供应商协议层。

## 实施步骤（每步一提交）

### R3j-1：路由约束固化

提交建议：`feat(p5.7-r3j): enforce executor/responder model routing`

1. no-tool 路由仅走 responder。
2. tool/complex-tool 路由仅走 executor。

### R3j-2：温度透传硬锁

提交建议：`fix(p5.7-r3j): enforce route temperature propagation`

1. tool 路径温度固定为 0。
2. no-tool 路径默认 0.2（可配置覆盖但需显式）。

### R3j-3：路由日志与追踪

提交建议：`feat(p5.7-r3j): add route observability fields`

1. 落日志字段：`route/model/temperature/toolCallCount`。
2. complex-tool 三阶段各自留痕。

### R3j-4：回归锁

提交建议：`test(p5.7-r3j): add dual-model routing regression lock`

1. 路由与模型绑定测试。
2. 温度透传测试。
3. complex-tool 阶段化链路测试。

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. tool 路由不再误走 responder
5. 路由温度可断言
6. 无新增 `.only/.skip`

## 验收回传模板

```md
# P5.7-R3j 验收报告

## 提交
- <sha> <message>

## Gate
- npx tsc --noEmit:
- npm test:
- npm run docs:check:

## 关键证据
- no-tool -> responder:
- tool -> executor:
- temperature lock:
```
