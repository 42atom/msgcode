---
id: 0086
title: 让 fs_scope 成为真实配置并收口文件边界检查
status: done
owner: agent
labels: [refactor, bug, test, docs]
risk: medium
scope: workspace 配置与 Tool Bus 文件工具边界
plan_doc: docs/design/plan-260311-fs-scope-real-config-and-boundary-check.md
links: []
---

## Context

当前 `tooling.fs_scope` 可以写入 workspace config，但 `getFsScope()` 实现始终返回 `unrestricted`。这导致：

- 用户写入 `"tooling.fs_scope": "workspace"` 实际无效
- `read_file / write_file / edit_file` 看起来接了权限策略，实际始终全开

同时，Tool Bus 当前在 `workspace` 模式下使用 `filePath.startsWith(workspacePath)` 做边界判断。只要目录前缀碰撞（例如 `/tmp/ws` 与 `/tmp/ws-evil`），就可能误判为在工作区内。

## Goal / Non-Goals

- Goal: 让 `getFsScope()` 真实读取 workspace 配置
- Goal: 保持默认 `unrestricted` 不变，避免扩大变更面
- Goal: 收口 `workspace` 模式下的路径边界检查，避免前缀碰撞误判
- Goal: 更新 fs_scope 相关回归测试
- Non-Goals: 不把默认值改成 `workspace`
- Non-Goals: 不重做 `/tool` 命令面
- Non-Goals: 不处理其他审查项（skills/getToolPolicy/AgentProvider/LmStudio 命名）

## Plan

- [x] 新建 issue / plan，冻结范围
- [x] 修复 `getFsScope()` 读取真实 workspace 配置
- [x] 收口 Tool Bus 文件工具的工作区边界判断
- [x] 更新 fs_scope 与文件工具相关测试
- [x] 更新 changelog

## Acceptance Criteria

1. `setFsScope(projectDir, "workspace")` 后，`getFsScope(projectDir)` 返回 `"workspace"`
2. `workspace` 模式下，越界绝对路径会被 `read_file / write_file / edit_file` 拒绝
3. `unrestricted` 模式下，绝对路径仍可通过
4. 前缀碰撞路径（如 `<ws>-evil/...`）不会被误判为工作区内
5. 相关测试通过

## Notes

- 审查来源：`AIDOCS/reviews/260311-audit-2-fix-target-files.md`
- 实现结果：
  - `getFsScope()` 现在真实读取 workspace config，默认仍保持 `unrestricted`
  - `read_file / write_file / edit_file` 的 `workspace` 模式边界判断已改为统一 helper，不再用字符串前缀比较
  - 已补 `workspace/unrestricted` 与目录前缀碰撞场景测试
- 测试：
  - `npm test -- test/p5-7-r3i-fs-scope-policy.test.ts test/tools.bus.test.ts test/p5-6-8-r3b-edit-file-patch.test.ts`
  - 结果：`57 pass / 0 fail`

## Links

- Plan: docs/design/plan-260311-fs-scope-real-config-and-boundary-check.md
