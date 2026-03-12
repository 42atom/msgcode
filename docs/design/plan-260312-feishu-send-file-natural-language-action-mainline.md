# 自然语言文件回传动作题主链收口

## Problem

真实 Feishu 串行 BDD 已证明，当前模型在“把当前工作目录里的某个文件发回这个群里”这类自然语言动作题下，仍可能直接回复“已发好了”，但没有任何真实文件副作用。日志显示 `toolCallCount=0 route=no-tool`，说明文件发送链被模型当成纯聊天题绕开了。

## Occam Check

- 不加它，系统具体坏在哪？
  - 用户会看到“已发好了”，但群里没有真实文件消息；这是假完成，真实通道验收不通过。
- 用更少的层能不能解决？
  - 能。先收紧提示词、tool-loop 原生工具优先提示和 skill 说明书，不新增新的裁判层或动作编排器。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。它减少“自然语言动作题被当成解释题”的旁路，收回到 `LLM -> feishu_send_file -> 群文件消息 -> 模型回复` 单主链。

## Decision

选定方案：只在已有主链上增强动作题语义，让模型在自然语言文件回传场景下更稳定地走 `feishu_send_file`，并用真实 Feishu 串行 BDD 作为最终验收。

关键理由：

1. 问题已经被真实通道验证，不需要猜测式新增层
2. 文件发送是外部副作用动作，最该先在提示与 skill 合同上收紧
3. 这比再造一个“动作完成裁判层”更薄，也更符合“先改说明书，再改代码”的项目口径

## Alternatives

### 方案 A：新增动作题 fail-closed 裁判层

- 优点：可以更强制拦住口头完成
- 缺点：新增控制层，直接违背当前“不给系统再加裁判层”的主线

### 方案 B：增强提示词、tool-loop 原生工具优先提示与 skill 文案

- 优点：薄、直接、和当前 skill-first 主线一致
- 缺点：仍依赖模型理解提示，需要真实 BDD 持续回归锁住

推荐：方案 B

## Plan

1. 修改执行提示词
   - [prompts/agents-prompt.md](/Users/admin/GitProjects/msgcode/prompts/agents-prompt.md)
   - [prompts/fragments/exec-tool-protocol-constraint.md](/Users/admin/GitProjects/msgcode/prompts/fragments/exec-tool-protocol-constraint.md)
   - 明确“把当前工作目录里的某个文件发回当前群/当前会话”是动作题；没有真实 `feishu_send_file` 成功回执前，不得回答“已发好”“已发送”

2. 修改原生工具优先提示
   - [src/agent-backend/tool-loop.ts](/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts)
   - 当 `feishu_send_file` 可用时，进一步强调这类动作题没有真实回执前不得直接结束

3. 修改 skill 文案
   - [src/skills/runtime/feishu-send-file/SKILL.md](/Users/admin/GitProjects/msgcode/src/skills/runtime/feishu-send-file/SKILL.md)
   - 强调这是动作题，不是解释题

4. 同步与验证
   - 覆盖 runtime skill 安装目录
   - 重启 daemon
   - 跑定向测试、类型检查、docs 校验
   - 重跑真实 Feishu 串行 BDD

## Risks

- 若提示仍不够强，模型可能继续把动作题嘴上完成
- 若提示过宽，可能让别的纯解释题被不必要地工具化

回滚策略：

- 若误伤别的自然语言场景，先回滚本轮提示增强，仅保留 `0117` 里的失败恢复主链

## Test Plan

- 定向验证：
  - `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r3h-tool-failure-diagnostics.test.ts test/p5-7-r10-minimax-anthropic-provider.test.ts test/p5-7-r3g-multi-tool-loop.test.ts test/p5-7-r20-minimal-finish-supervisor.test.ts test/p5-7-r12-feishu-send-file.test.ts test/p5-7-r9-t2-skill-global-single-source.test.ts`
  - `npx tsc --noEmit`
  - `npm run docs:check`
- 真实 Feishu 串行 BDD：
  - 失败基线：`file-bdd-serial-1773300512`
  - 修复复测：`file-bdd-fix-1773300671`
  - 必须看到：
    - `Feishu 文件消息发送成功`
    - `Tool Bus: SUCCESS feishu_send_file`
    - `toolSequence=ok:feishu_send_file`
    - 群里真实文件消息

## Observability

- `msgcode.log` 继续作为唯一日志真相源
- BDD 结果同时看：
  - 群消息
  - 日志
  - workspace 产物

## Result

- 自然语言文件回传动作题已收紧为 `feishu_send_file` 优先主链
- runtime skills 已同步并在新 daemon 上生效
- 串行真实 Feishu BDD 已通过：
  - 失败基线：`file-bdd-serial-1773300512`
  - 修复通过：`file-bdd-fix-1773300671`
  - runId：`f800a916-75db-4c80-8403-c02fa2da0a06`
  - 日志：`Tool Bus: SUCCESS feishu_send_file`
  - 群回执：`已发好了。` + token

评审意见：[留空,用户将给出反馈]
