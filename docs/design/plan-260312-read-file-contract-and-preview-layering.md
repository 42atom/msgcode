# read_file 合同增强与工具预览分层

## Problem

参考文档《CLI is All Agents Need》指出两个最容易污染主链的点：

1. 文件读取必须自带二进制/大文件/下一步建议合同，而不是一把 UTF-8 硬读
2. 执行层和呈现层要严格分开；执行层产出真实结果与稳定预览，呈现层只转发

当前 `msgcode` 在这两点上都还不够收口：

- `read_file` 以前直接 `readFile(..., "utf-8")`，遇到二进制或超大文件要么直接报 raw error，要么把整段内容塞回主链
- `bash-runner` 已经有 stdout/stderr 预览与完整输出落盘，但 tool-loop 回灌前仍会再裁一次 preview；不同工具的“给模型看什么”分散在 runner、Tool Bus、tool-loop 多处

## Occam Check

- 不加这次改动，系统具体坏在哪？
  - 模型读到图片/PDF/超大文本时，会继续撞 raw error 或把大内容塞回上下文；bash/read_file 的预览又会在执行层和呈现层双重裁剪，主链继续混浊。
- 用更少的层能不能解决？
  - 能。不是再加一个 preview controller，而是把 preview 收回执行层，并让 tool-loop 优先转发它。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。bash/read_file 的“结果长什么样”从多处分散收回到执行层，tool-loop 只剩一条转发主链。

## Decision

选定方案：先对 `read_file` 与 `bash` 做“执行层产 preview，呈现层只转发”的收口，同时补齐 `read_file` 的二进制/大文件/路径错误正式合同。

关键理由：

1. 这是最接近 0119 审计结论且改动面最小的一批收益项
2. 不需要引入任何新控制层，只是把现有职责放回更合适的位置
3. 先把合同和 preview 分层收干净，再看是否有必要继续收工具面

## Plan

1. 扩展工具结果类型
   - 文件：`src/tools/types.ts`
   - 为 `ToolResult` 新增 `previewText`
   - 为 `read_file` data 补充 `path/truncated/byteLength/guidance`
2. 收口 Tool Bus 合同
   - 文件：`src/tools/bus.ts`
   - `bash`：基于已有 stdout/stderr/fullOutputPath 生成稳定 preview
   - `read_file`：增加二进制 sniff、大文件 preview、路径/目录错误 guidance
3. 简化 tool-loop 呈现层
   - 文件：`src/agent-backend/tool-loop.ts`
   - `serializeToolResultForConversation()` 优先转发 `previewText`
   - conversation tool result 继续保留通用 fallback，避免一次性打穿其它工具
4. 补回归和文档
   - 文件：`test/tools.bus.test.ts`
   - 文档：`issues/0120...`、`docs/CHANGELOG.md`

## Risks

1. `read_file` 预览阈值设得太保守，可能让小文件也被提前截断；回滚/降级：回退 `src/tools/bus.ts` 相关阈值与逻辑
2. 下游若隐式依赖 `read_file` 只返回 `{ content }`，可能出现兼容性漂移；回滚/降级：保留新增字段但恢复旧 preview 路径
3. tool-loop 若过度信任 `previewText`，其它工具未来可能也把不稳定内容塞进来；回滚/降级：对新增工具继续走原 fallback，bash/read_file 保持优先

## Test Plan

- `bun test test/tools.bus.test.ts test/p5-7-r25-tool-result-context-clip.test.ts test/p5-7-r3h-tool-failure-diagnostics.test.ts`
- `npx tsc --noEmit`
- `npm run docs:check`

## Observability

- 运行时行为变化：
  - `read_file` 失败时会给出更明确的“下一步建议”
  - `read_file` 大文件返回预览与 `[status] truncated-preview`
  - `bash` / `read_file` 的回灌内容将优先沿执行层 `previewText`

（章节级）评审意见：[留空,用户将给出反馈]
