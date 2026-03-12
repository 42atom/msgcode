# 原生工具优先的 prompt 与 skill 合同收口

## Problem

当前运行时已经把 `help_docs`、`write_file/edit_file`、tool preview 单一真相源逐步收进主链，但 prompt 和 skill 文档仍残留明显的 bash-first 口径：模型一上来就被提示“通过 bash 调 msgcode CLI”，skill README 也还把 runtime skill 描述成 `runtime skill -> bash -> CLI 命令`。这会削弱第一公民工具的价值，让 help 与 skill 不再是“按需探索”，而变成“默认都先绕 shell”。

## Occam Check

- 不加这次收口，系统具体坏在哪？
  - 模型仍会优先折返到 bash/CLI，原生工具、help_docs 和 skill 说明书的层次会继续混乱，真实主链纯度被 prompt 自己污染。
- 用更少的层能不能解决？
  - 能。只需收正文案和现有 hint，不增加任何新运行时层或新工具。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。把“原生工具 / help / skill / bash”重新排回单一主链，不再让 prompt 同时教两套路线。

## Decision

选定方案：只改 prompt、skill 文档和现有 skill hint，把骨架收正为：

1. 原生工具第一公民
2. `help_docs` 是 CLI 合同的正式探索入口
3. `skill` 是按需读取的说明书，不是默认执行层
4. `bash` 只用于 shell glue、系统命令、排障或当前没有原生工具的能力

核心理由：

1. 当前问题是叙事口径漂移，不是能力缺失
2. 改运行时前，先让模型听到的主线正确
3. 这一步最符合“先改提示词/合同/说明书，再考虑改代码”

## Plan

1. 收口 `/Users/admin/GitProjects/msgcode/prompts/agents-prompt.md`
   - 把“通过 bash 调 msgcode CLI”降为条件路径
   - 明确 `help_docs -> skill -> bash/CLI` 的探索顺序
   - memory 改为“读 skill 后走 msgcode memory CLI”，不再提 `main.sh`
2. 收口 `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`
   - 调整 skill 注入文案，与系统 prompt 统一
3. 收口 `/Users/admin/GitProjects/msgcode/src/skills/README.md`
   - 把 runtime skill 主链改成“真实调用合同”
4. 更新测试
   - `/Users/admin/GitProjects/msgcode/test/p5-7-r3n-system-prompt-file-ref.test.ts`
   - `/Users/admin/GitProjects/msgcode/test/p5-7-r9-t2-skill-global-single-source.test.ts`
5. 更新：
   - `/Users/admin/GitProjects/msgcode/issues/0119-cli-reference-vs-runtime-gap-review.md`
   - `/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md`

## Risks

- 风险 1：改得太轻，只改措辞不改真实 hint 顺序
  - 应对：同步收 `agents-prompt` 和 `tool-loop`，并补回归锁
- 风险 2：把 CLI 叙事彻底删掉，导致 memory 等无原生工具能力失去入口
  - 应对：保留 CLI 路径，但降为按需路径

回滚/降级策略：

- 本轮只改文案与测试；如方向不对，可直接回滚本次 commit

评审意见：[留空,用户将给出反馈]
