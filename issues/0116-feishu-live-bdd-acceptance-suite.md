---
id: 0116
title: 冻结 Feishu 真实通道 BDD 验收集并记录文件发送缺口
status: done
owner: agent
labels: [docs, testing, bdd]
risk: medium
scope: 把 Feishu live smoke 收口为真实通道 BDD 验收集，并记录当前自然语言文件发送缺口
plan_doc: docs/design/plan-260312-feishu-live-bdd-acceptance-suite.md
links:
  - issues/0098-feishu-live-verification-loop.md
  - issues/0099-skill-live-prompt-corpus-v1.md
---

## Context

当前仓库已经有两类测试资产：

- 仓库内 Cucumber BDD（`features/`）
- 真实 Feishu 通道上的 live smoke / skill corpus

但这两者之间还缺一层“真实通道上的 BDD 验收清单”：

- 仓库内 BDD 更偏控制面和运行时局部行为
- live smoke 已证明真实群、真实工具、真实 workspace 更接近最终验收
- 但目前还没有一份正式、可复用、可挂结果的 Feishu 自然语言验收集

本轮真实 smoke 也已经测出一个关键缺口：

- 自然语言浏览器信息收集：通过
- 自然语言文件回传：失败
  - 群里只回了“已把 smoke-a.txt 发回群里了 …”
  - 日志显示 `toolCallCount=0 route=no-tool`
  - 最近消息回读没有新的 `file` 类型消息

这说明“真实通道 BDD 验收集”不仅需要存在，还必须能挂出当前失败项。

## Goal / Non-Goals

### Goal

- 冻结一份 `Feishu live BDD acceptance suite v1`
- 明确它是主链能力改动的最终验收标准
- 把当前 `feishu_send_file` 自然语言失败写入正式验收缺口

### Non-Goals

- 本轮不新增自动化平台
- 本轮不直接修 `feishu_send_file` 自然语言失败
- 本轮不替换现有仓库内 `features/` Cucumber 集

## Plan

- [x] 新建 `0116` issue 与对应 plan，冻结边界
- [x] 形成一份 `AIDOCS` 下的 Feishu 真实通道 BDD 验收集
- [x] 把当前浏览器通过 / 文件发送失败的真实结果写进去
- [x] 明确它与现有 `0098/0099` 的关系和分工
- [x] 运行 `npm run bdd` 与 `docs:check`，确认仓库内 BDD 现状和文档门槛

## Acceptance Criteria

1. 仓库内有正式 issue + plan 说明什么叫 `Feishu live BDD acceptance suite`。
2. 存在一份可直接复用的真实通道 BDD 验收文档，包含场景、证据、通过标准。
3. 文档明确区分：
   - 仓库内 Cucumber BDD
   - 真实 Feishu 通道 BDD
4. 当前 `feishu_send_file` 自然语言失败已作为正式缺口写入。
5. 运行口径与证据口径已固定，不再靠聊天记忆传递。

## Notes

- 已确认仓库内正式 Cucumber BDD 入口仍可用：
  - `npm run bdd`
  - `10 scenarios (10 passed), 64 steps (64 passed)`
- 已确认真实 Feishu 通道自然语言 smoke 结果：
  - 浏览器自然语言场景通过
  - 文件回传自然语言场景失败（口头完成，无真实文件发送）
- 当前失败证据：
  - 最近消息回读中，`nl-file-1773297850426` 只有文本回复，无新 `file` 类型消息
  - 日志中该轮 `toolCallCount=0 route=no-tool`

## Links

- [Plan](/Users/admin/GitProjects/msgcode/docs/design/plan-260312-feishu-live-bdd-acceptance-suite.md)
- [Suite](/Users/admin/GitProjects/msgcode/AIDOCS/prompts/feishu-live-bdd-acceptance-suite-v1.md)
