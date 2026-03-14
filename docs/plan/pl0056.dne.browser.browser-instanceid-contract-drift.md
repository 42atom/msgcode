# browser instanceId 合同漂移修复

## Problem

真实运行中，模型在 browser 工具链里成功拿到实例信息后，收尾阶段又裸调 `tabs.list`，因为未传 `instanceId` 被 Tool Bus 以 `TOOL_BAD_ARGS` 拒绝。根因不是 runner 不支持，而是 skill 示例、prompt 提示和 manifest 文案没有把 `instanceId` 合同讲硬。

## Occam Check

- 不加它，系统具体坏在哪？
  真实日志已复现：`browser: 'tabs.list' requires 'instanceId'`，模型被错误示例带偏后会直接失败。
- 用更少的层能不能解决？
  能。只修真相源文案与提示，不加 fallback、不加中间层。
- 这个改动让主链数量变多了还是变少了？
  变少了。浏览器合同重新收口到同一份 prompt/skill/manifest 口径。

## Decision

只做最小收口：

1. system prompt 补强 `instanceId` 合同
2. runtime skill 修正错误示例
3. manifest 文案把 `tabs.list` / `instances.stop` 的必填性说清楚

不修改 browser runner，不新增自动猜测 `instanceId` 的恢复逻辑。

## Plan

1. 更新 [tool-loop.ts](/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts) 的 browser runtime hint
2. 更新 [patchright-browser/SKILL.md](/Users/admin/GitProjects/msgcode/src/skills/runtime/patchright-browser/SKILL.md)
3. 更新 [manifest.ts](/Users/admin/GitProjects/msgcode/src/tools/manifest.ts) 的 `instanceId` 描述
4. 更新测试：
   - [p5-7-r9-t2-skill-global-single-source.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r9-t2-skill-global-single-source.test.ts)
   - [p5-7-r13-runtime-skill-sync.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r13-runtime-skill-sync.test.ts)
5. 运行针对性测试并更新 CHANGELOG / issue

## Risks

- 风险低：只改提示词与文案，不改执行核
- 回滚：恢复上述 3 处文案改动即可

评审意见：[留空,用户将给出反馈]
