# 任务单：P5.6.13-R1A-EXEC（ToolLoop 契约收口）

优先级：P0（运行时正确性）

## 目标（冻结）

1. ToolLoop 单一真相源：运行时只保留一条执行主链。
2. `run_skill` 硬退场：删除工具定义、执行分支、可用列表与相关回流路径。
3. 工具调用契约硬化：核心工具参数进入 schema 校验。
4. Provider 适配契约固化：请求/响应/tool_calls 归一有统一入口。
5. 保持零语义变更：不新增命令，不改业务文案，不改 PI/Memory/SOUL 语义（仅做退场与收口）。

## 实施范围

- `/Users/admin/GitProjects/msgcode/src/lmstudio.ts`
- `/Users/admin/GitProjects/msgcode/src/providers/tool-loop.ts`
- `/Users/admin/GitProjects/msgcode/src/providers/openai-compat-adapter.ts`
- `/Users/admin/GitProjects/msgcode/src/tools/bus.ts`
- `/Users/admin/GitProjects/msgcode/src/tools/types.ts`（若包含 `run_skill` 类型定义）
- `/Users/admin/GitProjects/msgcode/test/*tool*`
- `/Users/admin/GitProjects/msgcode/test/*skill*`（仅修正受 `run_skill` 退场影响的断言）
- `/Users/admin/GitProjects/msgcode/test/*provider*`
- `/Users/admin/GitProjects/msgcode/test/*lmstudio*`
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`（仅索引同步）

## 非范围（明确禁止）

- 不新增 provider。
- 不改命令面（`/help`、`/model`、`/voice` 等）。
- 不做 UI/文案优化。
- 不做记忆系统改造（sqlite-vec 方案保持现状）。
- 不新增任何“替代文本协议”来补偿 `run_skill` 退场。

## 执行步骤

### R1：ToolLoop 单入口收口（必须先做）

1. 确认唯一主链为 `runLmStudioToolLoop(...)`。
2. `src/providers/tool-loop.ts` 退役执行职责：
   - 方案 A（推荐）：删除运行入口，仅保留纯解析 helper；
   - 方案 B：保留文件但禁止外部调用执行主链（导出移除/废弃标记+测试锁）。
3. 新增回归锁：禁止执行链再次使用 `process.cwd()` 作为 tool workspace。

### R2：工具参数契约硬化（四核心）

1. 对 `read_file / write_file / edit_file / bash` 增加参数 schema 校验。
2. 校验失败返回结构化错误，不进入工具执行体。
3. 保持现有错误码风格，避免口径漂移。

### R3：`run_skill` 硬退场（必须完成）

1. 从 `Tool Bus` 的 `TOOL_META`、`switch-case`、可执行判断链中删除 `run_skill`。
2. 清理 `ToolName`/策略 allow 列表/工具描述中的 `run_skill` 残留。
3. 清理运行时调用入口中对 `run_skill` 的依赖，禁止“静默兼容”。
4. 若有历史测试强依赖 `run_skill`，改为断言“已删除且不会回流”。

### R4：Provider Adapter 契约固化

1. 在 `openai-compat-adapter.ts` 固化统一入口：
   - `buildChatCompletionRequest`
   - `parseChatCompletionResponse`（若缺则补）
   - `normalizeToolCalls`（若缺则补）
2. `lmstudio.ts` 只消费 adapter 对外契约，不再直接拼装散落字段。
3. 新增回归锁：空 `tool_calls`、非法 `tool_calls`、单工具调用三类都可稳定解析。

### R5：回归锁与门禁

1. ToolLoop 失败短路行为不回退（继续保留）。
2. 观测字段不丢失：`toolCallCount/toolName/toolErrorCode/toolErrorMessage/exitCode`。
3. `run_skill` 零回流（源码与测试口径都锁住）。
4. 无新增 `.only/.skip`。

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. grep 锁：
   - `rg -n "workspacePath:\\s*process\\.cwd\\(\\)" src/providers src/lmstudio.ts` 结果为 0
   - `rg -n "\\brun_skill\\b" src test` 结果为 0（历史任务文档可保留，不纳入本检查）
   - `rg -n "it\\.skip|describe\\.skip|test\\.skip|\\.only\\(" test` 结果为 0

## 提交纪律

1. 禁止 `git add -A`。
2. 至少 3 提交，建议：
   - `toolloop-single-entry`
   - `run-skill-hard-cut`
   - `tool-schema-guard`
   - `provider-contract-lock+tests`
3. 单次提交变更文件数 > 20，直接拆分重做。

## 验收回传模板（固定）

```md
# P5.6.13-R1A-EXEC 验收报告

## 提交
- <sha> <message>

## 变更文件
- <path>

## Gate
- npx tsc --noEmit: pass/fail
- npm test: <pass>/<fail>
- npm run docs:check: pass/fail

## ToolLoop 收口证据
- 唯一主链入口:
- process.cwd 漂移检查:

## 契约锁证据
- run_skill 退场（rg 结果 + 关键文件片段）:
- 四核心 schema 校验:
- adapter request/response/tool_calls 归一:

## 风险与遗留
- 风险:
- 遗留:
```
