# plan-260311-tool-exposure-and-skill-runtime-terminology-cleanup

## Problem

`msgcode` 刚修过一次新工具被旧暴露逻辑吞掉的问题，但无 workspace 的默认路径仍保留手写旧名单；同时 runtime skill 同步实现与主文档还在使用已经被否决的 `managed` 语义。继续放着不收，会反复制造“默认入口旧、主线语义新”的漂移。

## Occam Check

1. 不加它，系统具体坏在哪？
   - 无 workspace 的 LLM 工具暴露会继续漏掉当前默认能力，复发“工具明明可用但模型看不到”的问题。
2. 用更少的层能不能解决？
   - 能。直接让默认分支复用 `DEFAULT_WORKSPACE_CONFIG`，并把 `managed` 命名改成 `runtime` 即可。
3. 这个改动让主链数量变多了还是变少了？
   - 变少了。旧硬编码入口与旧命名一起收口到当前单一真相源。

## Decision

采用最小整理方案：

1. 无 workspace 工具暴露统一读取默认 workspace 配置。
2. runtime skill 同步只保留 `runtime / optional` 术语。
3. 文档同步更新到更薄的 `runtime / optional / legacy-active / retired` 现实口径。

## Plan

1. 更新 `src/agent-backend/tool-loop.ts`
   - 无 workspace 分支改读 `DEFAULT_WORKSPACE_CONFIG["tooling.allow"]`
2. 更新 `src/lmstudio.ts`
   - 保持与 `tool-loop.ts` 一致
3. 更新 `src/skills/runtime-sync.ts`
   - `RETIRED_MANAGED_SKILL_IDS` -> `RETIRED_RUNTIME_SKILL_IDS`
   - `managedSkillIds` -> `runtimeSkillIds`
   - `syncManagedRuntimeSkills()` -> `syncRuntimeSkills()`
4. 更新调用方和测试
   - `src/commands.ts`
   - `src/cli.ts`
   - `test/p5-7-r13-runtime-skill-sync.test.ts`
   - `test/p5-7-r6-hotfix-gen-entry-tools-default.test.ts`
   - `test/p5-7-r8c-llm-tool-manifest-single-source.test.ts`
5. 更新主文档与 changelog
   - `issues/0071-*`
   - `docs/design/plan-260311-skill-layering-and-conflict-policy.md`
   - `docs/notes/research-260311-skill-layering-and-conflict-policy.md`
   - `docs/CHANGELOG.md`

## Risks

1. 若默认工具暴露直接照抄默认配置，可能把本不该暴露的工具带回来。
   - 回滚/降级：继续经过 `filterDefaultLlmTools()` 和 manifest 暴露层过滤。
2. 改动同步接口命名会影响调用方与测试。
   - 回滚/降级：本轮同步改完所有 repo 内调用，不保留双接口。

## Alternatives

### 方案 A：继续保持现状

优点：
- 零实现成本

缺点：
- 会继续保留一个旧入口和一套旧术语

不推荐。

### 方案 B：只改代码，不改文档

优点：
- 实现最快

缺点：
- 心智漂移仍在，下一轮还会误判

不推荐。

### 方案 C：代码与主文档同步收口（推荐）

优点：
- 改动小
- 真相源一致
- 不会引入新层

## Test Plan

至少覆盖：

1. 无 workspace 时 `getToolsForLlm()` 能看到当前默认工具面中的 `feishu_send_file`
2. 无 workspace 时 `vision` 仍被默认 suppress
3. runtime sync 测试改用 `runtimeSkillIds`
4. 现有工具暴露与 runtime sync 主链测试不回归

## Observability

本轮不新增运行时日志；以测试与 issue note 作为证据。

（章节级）评审意见：[留空,用户将给出反馈]
