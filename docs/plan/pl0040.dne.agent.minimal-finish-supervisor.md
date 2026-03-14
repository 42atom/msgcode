# Plan: 结束前最小监督闭环

Issue: 0040

## Problem

当前主 Agent 在工具循环准备收口时，只有一次“自判完成”机会。日志和历史问题已经证明，这会带来两类错误：

1. 没做完就停
2. 没验证就说做完

这类问题本质不是 scheduler/browser 等子系统能力不足，而是“结束判定”只有主 Agent 单点自判，缺少最小复核。

## Occam Check

### 1. 不加这次改动，系统具体坏在哪？

主 Agent 仍可能在证据不足时直接结束，出现“没做却说做了”或“改了但没验证”的假完成。

### 2. 用更少的层能不能解决？

能。只在“准备结束”时增加一次同模型复核，不加 supervisor provider、不加规则引擎、不加多角色平台。

### 3. 这个改动让主链数量变多了还是变少了？

主执行链不变，只在单一结束口增加一个最小检查点；主链仍是一条，没有新增并行控制链。

## Decision

采用“结束前一次最小复核 + 最多 3 次 CONTINUE”方案。

核心理由：

1. 监督员本身仍是 LLM，复用同模型即可先验证机制，避免先搭平台
2. 监督只在结束前触发，不参与过程控制，避免把主链改成审批流
3. 连续 3 次 `CONTINUE` 后 fail-closed，明确返回阻塞原因，防止无限循环
4. 发布策略明确为：运行态默认开启、测试环境默认关闭；这是有意决策，不是隐式默认，目的是先在真实主链验证机制，同时避免一次性打穿现有测试基线

## Alternatives

### 方案 A：规则系统判断是否允许结束

- 优点：实现表面上可控
- 缺点：把“证据是否足够完成”这种上下文判断硬编码到系统里，违背 manifesto

### 方案 B：单次同模型结束复核（推荐）

- 优点：层最少；复用现有 provider 与模型；容易验证
- 缺点：会多一次 LLM 调用；复核质量受主模型能力影响

## Plan

1. 在 `/Users/admin/GitProjects/msgcode/src/config.ts` 增加最小 supervisor 配置：
   - `supervisor.enabled`
   - `supervisor.temperature`
   - `supervisor.max_tokens`
   - 默认启用，默认复用主模型
2. 在 `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts` 增加统一监督辅助：
   - 构造结束前复核上下文
   - 调用同 provider / 同模型 / 无工具的最小监督请求
   - 严格解析 `PASS` / `CONTINUE: <原因>`
3. 在同一文件的唯一结束挂点接入监督闭环：
   - `PASS` 直接返回
   - `CONTINUE` 将原因回灌给主 Agent 继续下一轮
   - 连续 3 次 `CONTINUE` 后停止并返回阻塞原因
4. 不修改 `routed-chat.ts` 默认主链，不新增第二结束挂点
5. 新增最小行为测试：
   - 假完成被 supervisor 拦下并推动继续执行
   - 证据足够时 supervisor `PASS`
   - 连续 3 次 `CONTINUE` 后停止
6. 运行测试与 smoke，记录验证命令和关键输出

## Risks

1. 监督提示若过重，会变成新的流程裁判层；回滚/降级：收回到最小输出合同，仅保留 `PASS/CONTINUE`
2. 连续 `CONTINUE` 可能让模型空转；回滚/降级：保持 3 次硬上限并返回明确阻塞原因
3. provider 兼容差异可能让监督请求格式不一致；回滚/降级：使用现有 OpenAI/MiniMax 已接入请求函数，不新增新协议层
4. 运行态默认开启会一次性改变“何时允许结束”的行为；回滚/降级：设置 `SUPERVISOR_ENABLED=0` 可立即关闭

## Test Plan

1. `PASS` 场景：完成工具执行后，监督返回 `PASS`，结果正常结束
2. `CONTINUE` 场景：首轮假完成被拦下，主 Agent 接收原因后继续调用工具，最终通过
3. `3 次 CONTINUE` 场景：连续三次都未通过时停止并返回阻塞原因
4. 回归：不影响现有正常工具循环与 verify phase

## Observability

1. 在 action journal 中补充结束前监督的最小记录，便于复盘
2. 在日志中记录监督 decision / continue 次数 / 最终阻塞原因

（章节级）评审意见：[留空,用户将给出反馈]
