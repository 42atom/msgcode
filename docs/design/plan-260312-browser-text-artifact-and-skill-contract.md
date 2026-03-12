## Browser 正文 Artifact 主链与 Skill 合同收口

### Problem

`patchright-browser` skill 已经把“先用 browser 读正文，再落盘，再分段处理”定义成正确网页转写主链，但当前运行时只把 `tabs.text` 的标题/URL 预览回给模型，没有把正文作为 artifact 暴露出来。结果是说明书比运行时更先进，模型仍会掉回 `bash` 做正文主链。

### Occam Check

- 不加它，系统具体坏在哪？
  - 长文网页转写场景里，模型拿不到 `tabs.text` 的正文 artifact，只能凭短 preview 或退回 `bash`，skill 主链无法闭环。
- 用更少的层能不能解决？
  - 能。直接在现有 `browser` tool result 内补 `textPath` artifact 和稳定 preview，不加新 tool、不加新控制面。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。网页正文读取重新回到 `browser -> artifact -> read_file/bash` 一条主链，不再靠 skill 文案把正文主链偷偷转回 shell。

### Decision

选定方案：在现有 `browser tabs.text` 主链内补全文 artifact 落盘，并让 `previewText` 给出 `textPath/textBytes/status` 等稳定证据；同时微调 `patchright-browser` skill，把固定文件名改成示例。

核心理由：

1. 不新增工具，也不新增新的 preview 层，符合“单一主链”
2. 让 `browser` 重新成为网页正文的第一公民入口，而不是标题/URL 查询器
3. skill 继续做说明书，不再替运行时硬补合同缺口

### Alternatives

#### A. 只改 skill，不改运行时

- 优点：快
- 缺点：说明书继续承诺一个运行时没有暴露的正文主链，问题不真解决

#### B. 新增 `browser_read_article` 之类专用工具

- 优点：合同直接
- 缺点：新开工具面，加层，违背当前主线

### Plan

1. 扩展 `ToolDataMap.browser`，让 `tabs.text` 场景可带 `textPath/textBytes/truncated`
2. 在 `Tool Bus` 内为 `tabs.text` 落盘全文到 `artifacts/browser/`
3. 保持 `previewText` 纯执行层生成，只补 `textPath/textBytes/status`
4. 微调 `patchright-browser` skill，把固定文件名收口成“按任务生成唯一文件名”
5. 补测试：
   - `tabs.text` 成功时生成 artifact
   - preview 含 `textPath`
   - skill 不再写死 `article.raw.txt/article.md`

### Risks

- 风险：正文落盘过多，artifact 目录膨胀
  - 回滚：只保留 `tabs.text` 场景落盘，不扩到其他 browser operation
- 风险：preview 过长再次污染主链
  - 回滚：preview 只保留路径/字节数/短摘要，不回灌全文

### Test Plan

- `bun test test/tools.bus.test.ts test/p5-7-r7a-browser-tool-bus.test.ts test/p5-7-r15-agent-read-skill-bridge.test.ts`
- `npx tsc --noEmit`
- `npm run docs:check`

（章节级）评审意见：[留空,用户将给出反馈]
