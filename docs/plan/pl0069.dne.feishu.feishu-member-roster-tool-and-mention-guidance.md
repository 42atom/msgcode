# 飞书群成员 roster 工具与群聊 @ 规则

## Problem

当前 bot 已能拿到飞书群消息的 `senderId`，但还不能主动查询群成员列表，因此无法稳定建立多发言人的 `character-identity` 通讯录，也无法在定向对某个成员说话时精确 `@` 对方。

## Occam Check

- 不加它，系统具体坏在哪？
  群里虽然能识别“当前是谁在说话”，但无法薄接全群 roster，LLM 只能靠人工自我介绍逐步建表，定向回复也缺少稳定 `@` 能力。
- 用更少的层能不能解决？
  能。只加一个只读飞书工具 `feishu_list_members`，再补一条提示词规则，不新增人物平台。
- 这个改动让主链数量变多了还是变少了？
  变少了。把“当前 speaker 事实”和“群成员 roster 查询”收口成同一条飞书能力主线，避免继续靠猜或人工旁路。

## Decision

采用最小收口方案：

1. 新增只读工具 `feishu_list_members`
2. 返回最小字段：
   - `senderId`
   - `name`
   - `memberTotal`
3. 工具失败时，明确提示：
   - 机器人不在群里
   - 或飞书后台未开启群成员读取权限
4. 在系统提示词中加入飞书群聊定向说话时的 `@` 规则：
   - 已知对方 ID 才 `@`
   - 不知道 ID 先查 `feishu_list_members` 或 `character-identity`

## Plan

1. 新增 [src/tools/feishu-list-members.ts](/Users/admin/GitProjects/msgcode/src/tools/feishu-list-members.ts)
2. 注册到：
   - [src/tools/types.ts](/Users/admin/GitProjects/msgcode/src/tools/types.ts)
   - [src/tools/manifest.ts](/Users/admin/GitProjects/msgcode/src/tools/manifest.ts)
   - [src/tools/bus.ts](/Users/admin/GitProjects/msgcode/src/tools/bus.ts)
   - [src/config/workspace.ts](/Users/admin/GitProjects/msgcode/src/config/workspace.ts)
   - [src/routes/cmd-tooling.ts](/Users/admin/GitProjects/msgcode/src/routes/cmd-tooling.ts)
3. 修改 [prompts/agents-prompt.md](/Users/admin/GitProjects/msgcode/prompts/agents-prompt.md)
4. 修改 [src/skills/runtime/character-identity/SKILL.md](/Users/admin/GitProjects/msgcode/src/skills/runtime/character-identity/SKILL.md)
5. 增加测试：
   - [test/p5-7-r32-feishu-list-members.test.ts](/Users/admin/GitProjects/msgcode/test/p5-7-r32-feishu-list-members.test.ts)
   - 以及默认工具与提示词回归锁

## Risks

- 风险 1：现有工作区 `tooling.allow` 没有新工具，导致 LLM 仍无法用
  - 缓解：更新 repo 默认值，并直接修正当前常用 workspace 配置
- 风险 2：模型乱用 `@`
  - 缓解：提示词要求只有已知 ID 才 `@`，不知道先查，不准猜

## Rollback

- 回退上述文件即可恢复到“只有当前 speaker 事实，没有 roster 工具”的状态

评审意见：[留空,用户将给出反馈]
