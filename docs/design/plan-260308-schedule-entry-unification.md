# Plan: Schedule 域双入口合同统一

## Problem

当前 `schedule` 域存在两套入口：
- `msgcode schedule` CLI（完整能力：add/list/remove/enable/disable）
- `/schedule` 聊天命令（残缺能力：list/enable/disable + validate/reload）

**断裂点**：
- 用户在聊天里无法创建/删除 schedule
- 模型知道 CLI 能做，但聊天命令做不到
- 同域两套合同，认知负担重

**约束**：
- 不重构 scheduler 引擎
- 不新增 LLM tool
- 不新增控制层或编排层

## Occam Check

1. **不加它，系统具体坏在哪？**
   - 用户在聊天界面无法创建 schedule（核心能力缺失）
   - 模型 prompt 导向混乱（不知道让用户用哪套）
   - 测试需要同时维护两套期望

2. **用更少的层能不能解决？**
   - 能：`/schedule` 直接复用 CLI 的同一套函数
   - 不新增 adapter，不做框架化

3. **这个改动让主链数量变多了还是变少了？**
   - 主链数量不变
   - 但消除了"两套合同"的认知负担

## Decision

**选型：CLI 作为真相源**

核心理由：
1. CLI 已经有完整的合同定义（help-docs 输出）
2. CLI 的代码结构更清晰，测试更完善
3. 聊天命令本质上只是"另一个 UI"，不应该有独立的能力定义

**不选另一条的理由**：
- 如果让 CLI 去适配聊天命令，会破坏已有的测试和合同层
- 聊天命令的 `validate/reload` 是运维辅助工具，不应该成为 CLI 的正式合同

## Plan

### 步骤 1：在 `cmd-schedule.ts` 中实现 `add` / `remove` 命令 - ✅ 已完成

**复用逻辑**：
- 直接复用 `src/cli/schedule.ts` 的核心逻辑（cron 验证、jobId 生成、文件写入）
- 参数口径保持一致
- 错误码语义保持一致

**改动文件**：
- `src/routes/cmd-schedule.ts` — 新增 `handleScheduleAddCommand` / `handleScheduleRemoveCommand`
- 新增辅助函数：`validateCronExpression`, `generateJobId`, `atomicWrite`, `removeScheduleFromJobs`, `syncScheduleToJobs`, `resolveWorkspacePathParam`

### 步骤 2：更新命令注册 - ✅ 已完成

**改动文件**：
- `src/routes/commands.ts` — 注册新的命令处理器
  - 识别 `/schedule add ...` 和 `/schedule remove ...`
  - 添加 `scheduleAdd` / `scheduleRemove` case

### 步骤 3：真机验证 - ✅ 已完成

**测试结果**：
- 62 个测试全部通过
- CLI `help-docs --json` 正确输出 5 个 schedule 命令
- 没有破坏现有功能

### 步骤 4：提交 - 待执行

**Commit message**：
```
feat(schedule): 统一双入口合同，/schedule 补齐 add/remove 能力
```

## Risks

### 主要风险

1. **代码复用方式**
   - 风险：直接 import CLI 函数可能导致循环依赖
   - 缓解：CLI 函数应该是纯函数，不依赖 commander 上下文

2. **参数口径不一致**
   - 风险：聊天命令和 CLI 参数格式不同
   - 缓解：保持 CLI 参数格式，聊天命令适配

3. **错误处理不一致**
   - 风险：聊天命令和 CLI 错误返回格式不同
   - 缓解：聊天命令封装成 `CommandResult`，CLI 输出 `Envelope`

## Alternatives

### 方案 B：抽取公共逻辑到独立模块

**描述**：
- 创建 `src/schedule/core.ts`，包含所有核心逻辑
- CLI 和聊天命令都 import 这个模块

**优缺点**：
- 优点：更清晰的分层
- 缺点：新增一层，违反 Occam Check

**决策**：不做，过度设计

## Test Plan

1. 聊天命令测试：
   - `/schedule add` 成功创建 schedule
   - `/schedule remove` 成功删除 schedule
   - `/schedule add` 非法 cron 失败
   - `/schedule add` 重复 ID 失败

2. CLI 测试（已有，确保不受影响）：
   - `msgcode schedule add/remove` 行为不变

## Observability

无运行时行为变化，不需要额外日志

---

**评审意见**：[留空，用户将给出反馈]
