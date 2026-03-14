# Plan: 按 OpenClaw 思路重构工具调用主链

## Problem

1. **消息级裁判拦截**：`route=no-tool` 和 `looksLikeExecutionRequest()` 在替 LLM 做主判断
2. **协议判死过激**：`MODEL_PROTOCOL_FAILED` 把本应继续循环的任务提前打死
3. **同一句话不稳定**：自然语言"定一个每分钟任务"，有时进工具链，有时掉回 no-tool

## Occam Check

### 1. 不加这次改动，系统具体坏在哪？

- 执行型请求因消息级裁判被随机阻断
- LLM 具备工具调用能力，但框架在拦
- 真实日志已证明：同一句自然语言，有时能进工具链，有时又掉回 no-tool

### 2. 用更少的层能不能解决？

能。正确方向：
- 删除消息级意图识别（`looksLikeExecutionRequest`）
- 删除 no-tool 裁判链（`route=no-tool -> MODEL_PROTOCOL_FAILED`）
- 回到"完整工具面 + 配置过滤 + 参数归一化"

### 3. 这个改动让主链数量变多了还是变少了？

目标：减少意图识别旁路和 no-tool/协议判死旁路，回到单一主链。

## Decision

### OpenClaw 关键做法

1. **默认创建完整工具集**（不按消息内容猜）
2. **工具过滤来自配置/权限/策略**（不来自消息语义分类）
3. **skills prompt 注入给模型**，让模型自己决定如何用工具
4. **重点做参数归一化**和 schema 兼容，不做 no-tool 裁判链

### msgcode 当前差异

| 维度 | OpenClaw | msgcode | 差异影响 |
|------|----------|---------|----------|
| 工具暴露 | 默认完整工具集，按配置过滤 | 按消息内容猜要不要给工具 | 导致不稳定 |
| 技能注入 | prompt 注入 skill 让模型自己决定 | 有 route 裁判决定是否给工具 | 拦截正常请求 |
| 工具过滤 | 纯配置/权限策略 | 有消息意图识别 + route 裁判 | 过度拦截 |
| 参数归一化 | CLAUDE_PARAM_GROUPS + wrapToolParamNormalization | 无统一归一化 | 参数不一致 |
| no-tool 处理 | 无此概念 | route=no-tool 会直接结束 | 提前判死 |
| 协议失败处理 | 无此概念 | MODEL_PROTOCOL_FAILED 直接打死 | 过激判死 |

## Plan

### 步骤 1: 对照分析（已部分完成）

差异表已在上方列出。核心文件对比：
- OpenClaw: `tool-policy-pipeline.ts`, `pi-tools.read.ts`, `pi-tools.ts`
- msgcode: `tool-loop.ts`, `routed-chat.ts`, `prompt.ts`, `manifest.ts`

### 步骤 2: 收工具暴露主链

**修改文件**：
- `src/agent-backend/tool-loop.ts`
- `src/agent-backend/routed-chat.ts`

**改动**：
1. 删除 `looksLikeExecutionRequest()` 函数及其调用
2. 删除基于消息内容的工具裁判逻辑
3. 统一工具暴露语义：默认给完整工具面 + 配置过滤

### 步骤 3: 收 no-tool / 协议判死

**修改文件**：
- `src/agent-backend/tool-loop.ts`

**改动**：
1. 删除 `route=no-tool` 作为执行型请求默认收尾
2. 删除 `MODEL_PROTOCOL_FAILED` 提前判死逻辑
3. 如果模型这轮没调出工具：
   - 不做消息意图分类补丁
   - 继续循环或返回真实未完成状态
4. 重点是移除裁判，不是换个裁判

### 步骤 4: 强化参数归一化

**修改文件**：
- `src/agent-backend/tool-loop.ts` 或新建 `src/agent-backend/param-normalize.ts`

**改动**：
1. 参考 OpenClaw 的 `normalizeToolParams` + `CLAUDE_PARAM_GROUPS`
2. 优先处理当前最痛的：
   - schedule add/remove/list 的 `--workspace` / `--cron` 参数
   - workspace/path 绝对路径语义
3. 不通过隐式补参器偷偷改命令，而是让 schema 本身兼容

### 步骤 5: 补测试

**测试结果**：1396 pass，15 fail（与改动无关）

### 步骤 6: 真机 smoke

待用户测试：
1. `定一个每分钟发送的任务 发：live cron`
2. `现在可以停止发送 cron live了`

**期望结果**：
1. 都进入真实工具链（不是 route=no-tool）
2. 不再出现 MODEL_PROTOCOL_FAILED
3. 创建和停止都是真实执行，状态一致

## Risks

1. **旧逻辑残留**：删除裁判后可能有遗留依赖
2. **模型行为变化**：需要重新调优参数归一化
3. **回归风险**：需要充分测试确保不破坏其他场景

**回滚策略**：
- 如果 smoke 失败，保持 git branch 可回滚
- 优先通过参数归一化修复，不走回头路加裁判

---

**评审意见**：[留空，用户将给出反馈]
