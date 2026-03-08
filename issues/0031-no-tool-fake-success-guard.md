---
id: 0031
title: 修复执行型请求的"无工具假完成"断裂
status: open
owner: agent
labels: [bug, agent, refactor]
risk: high
scope: agent-first 路由、tool-loop、伪工具文本处理
plan_doc: docs/design/plan-260308-no-tool-fake-success-guard.md
links: []
---

## Context

P0 松绑后发现新问题：

### 证据 1: 假成功
- 时间：2026-03-07 18:17:28
- 用户说：“现在可以停止发送 cron live了”
- 结果：
  - `toolCallCount=0`
  - `route=no-tool`
  - 最终回复：`已停止并删除 cron live 定时任务。`
- 但本机状态证明没删：
  - `/Users/admin/msgcode-workspaces/smoke/ws-a/.msgcode/schedules/cron-live.json` 仍存在
  - `/Users/admin/.config/msgcode/cron/jobs.json` 仍存在 job
  - `/Users/admin/.config/msgcode/cron/runs.jsonl` 在 18:18/18:19 仍继续 `status=ok`

### 证据 2: 伪 tool_call 穿透
- 时间：2026-03-07 18:19:18
- 结果：
  - `toolCallCount=0`
  - `route=no-tool`
  - 最终回复直接是：`[TOOL_CALL] {tool => "bash", args => { --command "msgcode schedule list" }} [/TOOL_CALL]`

## Goal / Non-Goals

### Goal
- 修复执行型请求 `toolCallCount=0 + route=no-tool` 的假成功
- 修复伪 `[TOOL_CALL]` 文本穿透给用户
- 让模型已表现出工具意图时，系统继续推进真实工具执行

### Non-Goals
- 不回滚 P0 松绑
- 不重新加回旧的前置 no-tool 阻断层
- 不新增 parser 层把伪文本硬解析成工具执行
- 不做 prompt 分层实验
- 不改 scheduler/browser 其他逻辑

## Plan

- [ ] 创建 issue 和 plan 文档
- [ ] 分析根因：allowNoTool 生效条件、伪工具文本漏出点
- [ ] 修复 no-tool 收口条件
- [ ] 修复伪工具文本穿透
- [ ] 补测试
- [ ] 真机验证
- [ ] 提交 commit

## Acceptance Criteria

1. 执行型请求不再出现 `toolCallCount=0 + 已完成` 的假成功
2. `[TOOL_CALL] ...` 伪文本不再穿透到最终回复
3. 真机删除 cron-live 时：真删掉，或真失败，不允许第三种状态
4. 现有松绑主链（read_file + bash）不被打回

## Notes

### 相关日志路径
- `/Users/admin/.config/msgcode/log/msgcode.log`

### 相关配置文件
- `/Users/admin/msgcode-workspaces/smoke/ws-a/.msgcode/schedules/cron-live.json`
- `/Users/admin/.config/msgcode/cron/jobs.json`
- `/Users/admin/.config/msgcode/cron/runs.jsonl`

## Links

- /Users/admin/GitProjects/msgcode/docs/design/plan-260308-no-tool-fake-success-guard.md
- /Users/admin/GitProjects/msgcode/issues/0028-llm-unshackle.md
