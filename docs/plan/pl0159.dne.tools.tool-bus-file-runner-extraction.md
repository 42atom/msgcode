# plan-260313-tool-bus-file-runner-extraction

## Problem

Tool Bus 里仍然直接实现 `read_file / write_file / edit_file` 的完整文件域逻辑，包括 `fs_scope` 边界、二进制探测、大文件 preview、整文件写入和补丁编辑。这让总线继续承担文件执行器职责，而不是只做网关。

## Occam Check

### 不加它，系统具体坏在哪？

- bus 继续内嵌文件系统实现
- `fs_scope` / 二进制保护 / patch 语义与总线耦合
- `normalizeEditFileEdits()` 之类文件域逻辑继续占在 bus 顶部

### 用更少的层能不能解决？

- 能。把文件域实现收成单一 runner，bus 只保留调用入口和结果包装

### 这个改动让主链数量变多了还是变少了？

- 变少了。bus 少一整块域逻辑，文件域执行真相源变成一处

## Decision

选定方案：新增 `src/runners/file-tools.ts`，承接 `read_file / write_file / edit_file` 的路径解析、`fs_scope` 检查、二进制与大文件保护、补丁编辑语义。Tool Bus 只调用 runner 并保留现有 preview builder 与 `ToolResult` 结构。

## Plan

1. 新增 `src/runners/file-tools.ts`
2. 修改 `src/tools/bus.ts`
   - 删除文件实现细节
   - 删除仅由文件工具使用的 helper
   - 改为调用 file runner
3. 更新测试
   - `test/tools.bus.test.ts`
   - `test/p5-7-r3i-fs-scope-policy.test.ts`
   - `test/p5-6-8-r3b-edit-file-patch.test.ts`
4. 更新 `docs/CHANGELOG.md`
5. 运行验证

## Risks

1. 文件边界行为容易被“搬家”时误伤
   - 回滚：回退 file runner 与 bus 中文件工具部分
2. 静态测试当前可能绑定 `bus.ts` 细节
   - 回滚：调整测试口径为“文件域真相源”而非固定文件路径

## Test Plan

- `PATH="$HOME/.bun/bin:$PATH" bun test test/tools.bus.test.ts test/p5-7-r3i-fs-scope-policy.test.ts test/p5-6-8-r3b-edit-file-patch.test.ts`
- `npx tsc --noEmit`
- `npm run docs:check`

（章节级）评审意见：[留空,用户将给出反馈]
