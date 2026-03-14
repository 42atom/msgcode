# Plan: 收口模型默认工具面到 read_file 与 bash

Issue: 0018

## Problem

最近真实对话已经证明，文件写改相关的默认工具面太宽：`write_file/edit_file` 虽然底层实现存在，但对模型来说既增加协议选择成本，又把错误路径继续暴露出来。结果不是“更强”，而是更容易在文件编辑任务里摔在工具合同、显式偏好和错误参数上。

## Occam Check

- 不加它，系统具体坏在哪？
  模型仍会在真实任务中优先尝试 `write_file/edit_file`，继续重复 `edit_file` 合同错误和工具协议失败，用户会继续被“明明 bash 能做，系统却先把模型带沟里”拖累。
- 用更少的层能不能解决？
  能。直接缩小默认暴露面，让模型默认只用 `read_file + bash` 处理文件，不新增裁判层、不新增恢复层。
- 这个改动让主链数量变多了还是变少了？
  变少了。把“读文件一套、写文件两套、编辑文件一套”的默认多路径，收口成“先读，再用 bash 写改”的单一路径。

## Decision

采用最小可删方案：

1. 默认工作区与 `/pi on` 只保证 `read_file + bash` 进入文件主链。
2. `write_file/edit_file` 保留底层实现，但退出默认 LLM 暴露层。
3. Prompt、`/tool allow` 提示、历史兼容壳默认口径统一为：
   - 读文件：`read_file`
   - 写/改文件：`bash`
4. 对旧工作区配置，`getToolsForLlm()` 仍会过滤掉 `write_file/edit_file`，避免老配置把坏工具重新暴露给模型。

## Plan

1. 收口默认配置与命令提示
- 修改：
  - `/Users/admin/GitProjects/msgcode/src/config/workspace.ts`
  - `/Users/admin/GitProjects/msgcode/src/routes/cmd-model.ts`
  - `/Users/admin/GitProjects/msgcode/src/routes/cmd-tooling.ts`
- 验收点：
  - 新工作区默认不再包含 `write_file/edit_file`
  - `/pi on` 只自动补最小文件主链工具

2. 收口 LLM 暴露层与 prompt
- 修改：
  - `/Users/admin/GitProjects/msgcode/src/agent-backend/tool-loop.ts`
  - `/Users/admin/GitProjects/msgcode/src/lmstudio.ts`
  - `/Users/admin/GitProjects/msgcode/src/tools/manifest.ts`
  - `/Users/admin/GitProjects/msgcode/prompts/agents-prompt.md`
- 验收点：
  - 旧配置里即使仍有 `write_file/edit_file`，`getToolsForLlm()` 也不会暴露它们
  - prompt 不再建议模型优先用 `write_file/edit_file`

3. 更新测试与变更记录
- 修改：
  - `/Users/admin/GitProjects/msgcode/test/p5-6-8-r4g-pi-core-tools.test.ts`
  - `/Users/admin/GitProjects/msgcode/test/p5-6-8-r3b-edit-file-patch.test.ts`
  - `/Users/admin/GitProjects/msgcode/test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts`
  - `/Users/admin/GitProjects/msgcode/test/p5-7-r8c-llm-tool-manifest-single-source.test.ts`
  - `/Users/admin/GitProjects/msgcode/test/p5-7-r9-t2-skill-global-single-source.test.ts`
  - `/Users/admin/GitProjects/msgcode/test/tools.bus.test.ts`
  - `/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md`
- 验收点：
  - 定向测试通过

## Risks

1. 旧测试和旧工作区可能仍假设 `write_file/edit_file` 默认可见。
回滚/降级：保留底层实现，只回滚默认暴露层改动。

2. 个别场景用 `bash` 写文件可能比专用工具更粗糙。
回滚/降级：后续若真需要专用写工具，先重做合同与观测，再考虑重新暴露，而不是直接恢复旧主链。

## Rollback

- 回退 `workspace/tool-loop/lmstudio/prompt/cmd-*` 本轮改动，恢复旧默认暴露面。

## Test Plan

- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-6-8-r4g-pi-core-tools.test.ts`
- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-6-8-r3b-edit-file-patch.test.ts`
- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r3l-7-tool-protocol-retry-and-soul-normalize.test.ts`
- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r8c-llm-tool-manifest-single-source.test.ts`
- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r9-t2-skill-global-single-source.test.ts`
- `PATH="$HOME/.bun/bin:$PATH" bun test test/tools.bus.test.ts`

## Observability

- 继续观察：
  - `MODEL_PROTOCOL_FAILED`
  - `Tool Bus: FAILURE edit_file`
  - `toolCallCount=0 route=no-tool`

（章节级）评审意见：[留空，用户将给出反馈]
