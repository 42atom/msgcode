# plan-260313-retire-file-system-cli-wrappers

## Problem

`msgcode` 当前仍把两类本该直接交给 Unix/macOS 的能力公开成 agent-facing CLI：

- `file find/read/write/delete/move/copy`
- `system info/env`

这两组命令没有跨越新的物理边界，也没有桥接新的外部能力；它们只是把原生 shell 已经稳定提供的机制，再包成一层 msgcode 私有合同。结果是：

- 主链变成 `模型 -> help-docs -> msgcode file/system -> envelope -> 模型`
- 而不是更直接的 `模型 -> 原生工具/原生 shell -> 真实结果 -> 模型`
- skill 与 prompt 也会被迫继续解释一层本不该存在的 wrapper

## Occam Check

### 不加它，系统具体坏在哪？

- LLM 会继续为了本地文件/系统壳操作记忆 `msgcode file/system` 方言
- 帮助文档、skill 与提示词会继续浪费上下文解释“二手 Unix 命令”
- 原生 stderr / exit code 的诊断价值被 msgcode envelope 稀释

### 用更少的层能不能解决？

- 能。直接退掉 `file/system` 两组公开 CLI，不新增任何新层
- 本地文件和系统操作改回原生工具或 shell
- 只保留最薄 retired compat shell，负责迁移提示

### 这个改动让主链数量变多了还是变少了？

- 变少了。删掉的是一整层重复包装，不是新增控制面

## Decision

选定方案：退役 `file/system` 公开 CLI 包装层，把本地文件与系统壳操作还给原生工具与 shell。

核心理由：

1. `file/system` 没有提供新的桥接能力，只是在重复 Unix/macOS 现成机制
2. 退掉后，LLM 的默认执行路径更短，错误反馈更原生
3. 这次改动只删层、不加层，符合仓库“先收口、先做薄”的主线

## Plan

1. 收口 CLI 入口
   - 更新 `src/cli.ts`
   - `msgcode --help` 不再公开 `file/system`
   - `msgcode file ...` / `msgcode system ...` 只在 direct invoke 时进入 retired compat shell
   - `msgcode file send ...` 继续通过 `file-send` retired compat 保留历史迁移提示

2. 收口命令实现
   - 更新 `src/cli/file.ts`
   - 删除 `find/read/write/delete/move/copy` 公开实现，改为 retired domain shell
   - 保留 `createEnvelope` 与 `file-send` retired compat
   - 更新 `src/cli/system.ts`
   - 删除 `info/env` 公开实现，改为 retired domain shell

3. 收口正式合同
   - 更新 `src/cli/help.ts`
   - `help-docs --json` 不再导出 `file/system`
   - agent-facing CLI 正式合同收口为 msgcode 特有桥接能力

4. 收口说明书
   - 更新 `AGENTS.md`
   - 更新 `prompts/agents-prompt.md`
   - 更新 `src/skills/README.md`
   - 更新 `src/skills/runtime/file/SKILL.md`
   - 更新 `src/skills/runtime/index.json`
   - 明写：本地文件与系统操作优先使用原生工具或 shell，不要再期待 `msgcode file/system`

5. 回归验证
   - 更新相关测试
   - 运行 targeted tests
   - 运行 `npx tsc --noEmit`
   - 运行 `npm run docs:check`

## Risks

1. 历史脚本或旧提示词仍调用 `msgcode file/system`；回滚/降级：保留 retired compat shell 给出明确迁移提示，不直接静默失效
2. 文档与 skill 仍残留旧口径；回滚/降级：以当前 issue 为真相源继续补齐，不恢复旧 CLI 主链

## Alternatives

### 方案 A：仅从 `help-docs` 隐藏，保留 `file/system` 可执行

不推荐。

原因：

- 这只是“认知屏蔽”，不是删层
- 旧包装层还在，后续仍可能被 prompt、脚本或人类帮助重新唤回

### 方案 B：完整保留 `file/system`，只改 prompt

不推荐。

原因：

- 问题根因在于能力边界定义错了，不只是文案写错了

## Migration / Rollout

- 第一阶段：从公开面和正式合同退掉 `file/system`
- 同阶段：保留 direct invoke retired compat shell
- 第二阶段：观察仓库内是否仍有现役依赖，再决定是否进一步删除 retired compat 代码

## Test Plan

- `msgcode --help` 不包含 `file` 与 `system`
- `msgcode help-docs --json` 不包含 `file` 与 `system`
- `msgcode file read README.md` 返回 retired 提示与 shell 迁移指引
- `msgcode system info` 返回 retired 提示与 shell 迁移指引
- runtime file skill 同步后不再示例 `msgcode file ...`
- `npx tsc --noEmit`
- `npm run docs:check`

（章节级）评审意见：[留空,用户将给出反馈]
