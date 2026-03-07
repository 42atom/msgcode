# Plan: LLM Allowed Tools 单一真相源与说明书收口

Issue: 0005

## Problem

当前 `msgcode` 存在三套彼此漂移的工具口径：

1. workspace 配置中的 `tooling.allow` 表示“允许执行哪些工具”
2. Tool Bus 实际支持并可执行的工具集合
3. 执行核发给模型的 `tools[]`，当前由 `PI_ON_TOOLS` 这套硬编码白名单生成

结果是：

- `browser` 已被 workspace 配置允许，也已在 Tool Bus 中真实可执行
- 但执行核给模型的说明书中没有 `browser`
- 模型路由到 `tool` 后仍可能 `toolCallCount=0`，最终报 `MODEL_PROTOCOL_FAILED`

这不是浏览器 runner 故障，而是“给 AI 的工具说明书”没有单一真相源。

## Decision

采用“**工具说明书注册表 + allowed tools 派生暴露**”方案，收口为单一真相源。

核心决策：

1. 新增统一工具说明书注册表，例如 `src/tools/manifest.ts`
2. `tooling.allow` 只表达“该 workspace 允许哪些工具名”
3. 执行核暴露给模型的 `tools[]` 必须由 `tooling.allow ∩ TOOL_MANIFESTS` 动态生成
4. 排查口径必须结构化输出 `allowed / registered / exposed / missing`

核心理由：

1. 彻底消除 `allow != expose` 的漂移
2. 将“权限”和“说明书”分层，便于定位是配置问题还是注册问题
3. 后续新增 `browser/web/desktop` 时不必再复制一份白名单

（章节级）评审意见：[留空,用户将给出反馈]

## Alternatives

1. 继续维护 `PI_ON_TOOLS` 并手工同步 `tooling.allow`
   - 优点：改动最小
   - 缺点：仍然会继续漂移，本次 `browser` 漏暴露就是该方案的现实后果

2. 直接把 `tooling.allow` 做成一份完整数组说明书
   - 优点：表面上单文件
   - 缺点：配置与 schema/描述耦合过深，不利于复用，也不便于按工具名排查

3. 工具说明书注册表 + allowed tools 派生暴露（推荐）
   - 优点：结构清晰，天然支持排查与测试
   - 缺点：需要一次性重构执行核取工具的入口

（章节级）评审意见：[留空,用户将给出反馈]

## Plan

1. 新增统一工具说明书注册表
   - 文件：
     - `src/tools/manifest.ts`
   - 内容：
     - `ToolManifest` 类型
     - `TOOL_MANIFESTS: Record<ToolName, ToolManifest>`
     - 每个工具最小字段：`name`、`description`、`parameters`、`riskLevel`
   - 验收：
     - `browser`、`bash`、`read_file`、`write_file`、`edit_file` 至少具备完整说明书

2. 新增 LLM 工具暴露解析器
   - 文件：
     - `src/tools/manifest.ts` 或独立 `src/tools/exposure.ts`
   - 内容：
     - `resolveLlmToolExposure(workspacePath)` 或等价函数
     - 返回结构化信息：`allowedTools`、`registeredTools`、`exposedTools`、`missingManifests`
   - 验收：
     - 给定 workspace 配置后，能稳定产出可排查的暴露结果

3. 重构执行核工具入口
   - 文件：
     - `src/agent-backend/tool-loop.ts`
     - `src/agent-backend/types.ts`
     - `src/agent-backend.ts`
     - `src/lmstudio.ts`（若仍有兼容入口）
   - 内容：
     - 删除对 `PI_ON_TOOLS` 作为 LLM 暴露清单的依赖
     - 改为调用统一暴露解析器
   - 验收：
     - `browser` 在 allowed 且已注册时真实出现在发给模型的 `tools[]`

4. 补齐回归锁与证据
   - 文件：
     - 新增或修改相关测试
   - 内容：
     - 允许但未注册时，返回明确 `missingManifests`
     - 已允许且已注册的 `browser` 必须被暴露
     - 未允许的工具即使已注册，也不能被暴露
   - 验收：
     - 测试覆盖 `allowed / registered / exposed / missing` 四类状态

## Risks

1. 风险：重构时只修执行核，不修兼容入口，导致 `src/lmstudio.ts` 等旧入口继续串旧白名单
   - 回滚/降级：保留兼容 wrapper，但所有入口统一调用同一暴露解析器

2. 风险：工具 schema 与 Tool Bus 参数校验再次分叉
   - 回滚/降级：首轮只收口最关键工具，并用回归锁保证字段一致

3. 风险：一次性把所有工具说明书补全，改动面过大
   - 回滚/降级：本轮先覆盖 `browser` 与当前主链常用工具，其他工具按注册表机制补齐

（章节级）评审意见：[留空,用户将给出反馈]

## Test Plan

1. 单测：
   - allowed 包含 `browser` 且 manifest 已注册时，`exposedTools` 必含 `browser`
   - allowed 不含 `browser` 时，`exposedTools` 不含 `browser`
   - allowed 含某工具但 manifest 缺失时，`missingManifests` 必含该工具

2. 集成：
   - `runAgentToolLoop()` 使用的工具集合来自统一暴露解析器
   - `AGENT_TOOLS` 或等价导出不再是独立硬编码白名单

3. 验证命令：
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run docs:check`

（章节级）评审意见：[留空,用户将给出反馈]

## Observability

建议新增最小诊断结构：

1. `allowedTools`
2. `registeredTools`
3. `exposedTools`
4. `missingManifests`

至少在测试与 debug 日志中可直接打印，作为“为什么 AI 没拿到说明书”的第一现场证据。

（章节级）评审意见：[留空,用户将给出反馈]
