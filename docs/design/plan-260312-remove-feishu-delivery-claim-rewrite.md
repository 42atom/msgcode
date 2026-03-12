# 移除系统对飞书发送措辞的最终改写

## Problem

当前 `tool-loop` 在模型给出最终答案后，还会用 `hardenFeishuDeliveryClaim()` 二次检查飞书文件发送语义。若模型声称“已发送”，但本轮没有成功的 `feishu_send_file` 结果，系统会直接改写成固定告知文案。这样虽然避免了假阳性，但也让系统再次代替模型交付最终话术。

## Occam Check

- 不加它，系统具体坏在哪？
  - 系统会继续在最终阶段篡改模型原答案，形成“模型给出交付 -> 系统重写交付”的双主语路径。
- 用更少的层能不能解决？
  - 能。删除重写 helper，保留工具真结果和现有 skill/系统提示，不增加新的发送校验层。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。删掉“模型最终答案 -> 系统二次改写”的旁路，回到“工具结果 -> 模型交付”的单一主线。

## Decision

选定方案：删除 `hardenFeishuDeliveryClaim()` 与相关调用，只保留“发送文件时优先走 `feishu_send_file`”的提示文案。文件是否真正发送成功，继续由 `feishu_send_file` 工具结果负责；最终怎么向用户表述，交回模型。

关键理由：

1. 这条 helper 本质上是系统代答，不符合当前主线
2. 现有工具真相和 skill 提示已足够约束模型，不需要再加最后一层改词
3. 删除后能让“系统只给证据，模型做交付”更一致

## Alternatives

### 方案 A：保留现状

- 优点：继续阻止模型口头声称“已发送”
- 缺点：系统继续直接改写最终交付

### 方案 B：删除改写 helper，仅保留提示与工具真相

- 优点：主链更干净，模型交付重新归模型
- 缺点：个别模型仍可能口头夸大，需要靠 prompt/skill/live 测试收口

### 方案 C：把 helper 迁到新的发送裁判层

- 优点：形式上更“干净”
- 缺点：只是换地方继续抢执行权，违背当前方向

推荐：方案 B

## Plan

1. 更新 [src/agent-backend/tool-loop.ts](/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts)
   - 删除 `hardenFeishuDeliveryClaim()` 与其辅助函数
   - 删除 Anthropic / OpenAI 两条路径上的调用
   - 更新 `__test` 导出

2. 更新 [test/p5-7-r12-feishu-send-file.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r12-feishu-send-file.test.ts)
   - 移除对 `tool-loop.__test.hardenFeishuDeliveryClaim` 的依赖
   - 保留工具结果的成功/失败真相回归锁

3. 更新 [docs/CHANGELOG.md](/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md)

4. 验证
   - `bun test` 定向回归
   - `npx tsc --noEmit`
   - `npm run docs:check`

## Risks

- 删除后，个别模型可能重新出现“工具没真成功，但嘴上说已发送”的误报
- 这类风险应通过 skill 文案、系统提示、live prompt corpus 和真实发送日志收口，而不是再加最后一层改词

回滚策略：

- 若 live loop 显示误报率显著回升，可回滚本轮改动
- 但不应改成新的发送裁判层；长期方案仍应优先通过提示与真实验证收口

评审意见：[留空,用户将给出反馈]
