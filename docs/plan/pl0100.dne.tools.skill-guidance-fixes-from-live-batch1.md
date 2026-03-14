# Skill Guidance Fixes From Live Batch 1

Issue: 0100

## Problem

第一批 live run 的通过/失败非常集中：

- 文本与文件写入主链可用
- 文件回传和浏览器访问都没有优先走原生工具

说明当前最值得先修的是 **skill 引导默认路径**：

- `feishu-send-file` 还没有把“必须优先走原生工具”写到足够硬
- `patchright-browser` 还容易让模型把 CLI/bash 当第一选择

## Occam Check

1. 不加它，系统具体坏在哪？
   - live 测试会继续稳定暴露同一类偏差：模型看到有 skill，但默认仍走 `bash`，导致文件回传和浏览器任务不稳定。
2. 用更少的层能不能解决？
   - 能。先改 skill 文案与 runtime index 描述；若仍失败，再只补执行核一段最小“原生工具优先”提示，不引入新层。
3. 这个改动让主链数量变多了还是变少了？
   - 变少了。把“原生工具优先”写死，减少 `bash` 这条误入路径。

## Decision

采用两步最小方案：

1. 先做 **skill 文案收紧 + runtime index 对齐**
2. 如果 live 仍失败，再补 **tool-loop 最小原生工具优先提示**
3. 再用同一条 live verification loop 复测

理由：

1. 先验证“更好的说明书是否足以纠偏”
2. 若 skill-only 不够，再补最小执行核提示，而不是新加控制层
3. 真实结果要和 live verification loop 一起看，不能脱离真实工具面下结论

## Plan

1. 修改：
   - `src/skills/runtime/feishu-send-file/SKILL.md`
   - `src/skills/runtime/patchright-browser/SKILL.md`
   - `src/skills/runtime/index.json`
2. 同步到用户技能目录
3. 若 skill-only 复测仍失败，修改：
   - `src/agent-backend/tool-loop.ts`
   - `test/p5-7-r9-t2-skill-global-single-source.test.ts`
4. 用同一条 live verification loop 复测：
   - `skill-live-03`
   - `skill-live-05`
5. 记录耗时、回复、工具路径与结果
6. 明确区分“模型选错路”和“workspace 工具面没开”两类原因

## Risks

- 风险：skill 文案收紧仍不足以纠偏
  - 回滚/降级：保留文案改动，再补 tool-loop 最小原生工具优先提示
- 风险：live 结果被 workspace 工具配置污染
  - 回滚/降级：在测试 workspace 里显式设置 `tooling.allow`，不要用“空配置”冒充全能力环境

（章节级）评审意见：[留空,用户将给出反馈]
