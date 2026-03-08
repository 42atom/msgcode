# Plan: 修复 schedule 停止链的 workspace 参数和投影同步断裂

## Problem

1. **workspace 参数缺失**：自然语言删除请求生成的 CLI 命令缺少 `--workspace`
2. **投影同步断裂**：schedule 文件删除后 jobs.json 里的投影 job 没有同步删除

## Occam Check

### 1. 不加这次改动，系统具体坏在哪？

- 停止请求虽已进入真实工具链，但命令缺参导致删不掉
- 即便 schedule 文件没了，job 投影还继续跑

### 2. 用更少的层能不能解决？

能。正确方向：
- 把 workspace 绝对路径明确暴露给 LLM
- 修 schedule remove 的投影删除同步

### 3. 这个改动让主链数量变多了还是变少了？

目标：让"删 schedule -> 删投影 -> 停止运行"回到单一主链。

## Decision

### 问题 1: workspace 参数

在 tool-loop 的 system prompt 或 skill hint 里明确提示：
- `schedule add/remove/list` 命令必须显式带 `--workspace <abs-path>`
- 当前 workspace 绝对路径在 `buildWorkspacePathHint` 里已经提供了

需要检查：
1. prompt 是否已包含 workspacePathHint
2. skill 合同是否强调 workspace 参数

### 问题 2: 投影同步

需要检查 `schedule remove` 的实现：
1. 是否只删了文件
2. 是否删了 jobs.json 里的投影

## Plan

### 步骤 1: 检查 workspace 暴露

- 检查 `buildWorkspacePathHint` 是否在 tool-loop 里被调用
- 检查 prompt 是否包含 workspace 路径

### 步骤 2: 检查 schedule remove 实现

- 检查 `src/cli/schedule.ts` 的 remove 命令
- 检查是否同时删除了 jobs 投影

### 步骤 3: 修复

根据检查结果修复

---

**评审意见**：[留空，用户将给出反馈]
