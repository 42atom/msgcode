# /help 命令薄收口方案

Issue: 0049

## Problem

当前 `/help` 相关代码不是“一处定义，多处投影”，而是“多处手写，彼此尽量同步”：

- `src/routes/cmd-info.ts` 手写 `/help` 文案；
- `src/routes/commands.ts` 手写未知命令提示列表；
- `scripts/check-doc-sync.ts` 通过解析 `/help` 文本间接拿命令集合，还额外手工补 `extras`；
- `docs/release/v2.3.0.md` 宣称“已是单一注册表”，但现状并非如此。

这类设计的坏处不是炫技不足，而是每次新增/改名/隐藏命令时，都要去四处补字符串；一旦漏补，用户最先看到的 `/help` 就先失真。

另外，用户已明确要求系统尽量做薄，所以这里不能为了消灭重复，再额外发明一个“help 平台”。

## Occam Check

- 不加它，系统具体坏在哪？
  - 现在已经坏在“命令真实存在，但 `/help` 曾漏列”；同类漂移还会继续出现在未知命令提示和 docs sync。
- 用更少的层能不能解决？
  - 能。不是再加一层独立注册表，而是把 help 元数据直接内聚到 `cmd-info.ts`，其他地方只投影。
- 这个改动让主链数量变多了还是变少了？
  - 变少。现状至少有 `/help`、未知命令提示、docs sync、release 叙事四份视图；改后收口成 `cmd-info.ts` 一份 help 元数据。

## Decision

采用“**`cmd-info.ts` 内聚 help 元数据 + 轻量投影函数**”方案，只收口 `/help` 相关显示元数据，不把解析/分发 DSL 化，也不额外新增 `command-registry.ts`。

核心理由：

1. 最小可删：只把手写字符串变成同文件常量，不改业务命令实现，不新增控制面。
2. 更薄：避免为了 help 再建一个“注册表文件层”，减少文件数和心智负担。
3. 主链清晰：`cmd-info.ts/help entries -> /help`、`-> unknown hint`、`-> docs sync`。
4. 风险可控：不碰 `handleRouteCommand()` 的业务分发，不碰 `handlers.ts` 会话命令逻辑。

## Alternatives

### 方案 A：继续手写字符串，只补更多测试

优点：

- 改动最小
- 无需新结构

缺点：

- 仍然是多份字符串同步
- 每加命令都要改多处
- `scripts/check-doc-sync.ts` 继续依赖“解析文案”这种脆弱方式

结论：能止血，不能长期保持薄和稳。

### 方案 B：`cmd-info.ts` 内聚 help 元数据，只驱动显示与校验（推荐）

优点：

- 一份元数据解决 `/help`、未知命令提示、docs sync
- 不新增独立文件层，系统更薄
- 不碰现有解析/分发主链
- 非常符合当前仓库“薄壳 + 按命令域拆文件”的风格

缺点：

- 仍需人工保证 help 元数据与 parser/dispatcher 一致
- 需要补一层回归测试锁

结论：最符合奥卡姆剃刀。

### 方案 C：独立 `command-registry.ts` 文件，驱动帮助与校验

优点：

- 比手写字符串更统一
- 若后续 help 元数据持续膨胀，迁移更方便

缺点：

- 对当前问题来说多了一层文件和概念
- 容易从“help 元数据”继续滑向“全量命令平台”

结论：作为后备扩展，不应是当前默认方案。

## 最小可删版本

直接在：

- `src/routes/cmd-info.ts`

中新增一个仅服务于“可见命令元数据”的常量，例如：

```ts
export interface SlashCommandDocEntry {
  key: string;
  group: "群组绑定" | "编排层" | "会话（tmux/direct）" | "干预" | "语音（direct 模式）" | "其他";
  usage: string;
  summary: string;
  keywords: string[];
  visibleInHelp: boolean;
}

const HELP_ENTRIES: SlashCommandDocEntry[] = [
  {
    key: "bind",
    group: "群组绑定",
    usage: "/bind <dir>",
    summary: "绑定工作目录",
    keywords: ["/bind"],
    visibleInHelp: true,
  },
  {
    key: "schedule",
    group: "编排层",
    usage: "/schedule [list|validate|enable|disable|add|remove]",
    summary: "定时任务",
    keywords: ["/schedule"],
    visibleInHelp: true,
  },
];
```

然后只提供 3 个投影函数：

```ts
export function renderSlashHelpText(): string;
export function getVisibleSlashKeywords(): string[];
export function renderUnknownCommandHint(): string;
```

这样：

- `cmd-info.ts` 不再手写大段帮助字符串，只 `return { message: renderSlashHelpText() }`
- `commands.ts` 默认错误提示不再手写命令列表，只调用 `renderUnknownCommandHint()`
- `scripts/check-doc-sync.ts` 不再解析帮助文本再补 extras，只直接调用 `getVisibleSlashKeywords()`

## 扩展版本

如果最小版本稳定，再考虑第二阶段，但仍然保持收口，不平台化：

1. 给 help 元数据增加 `aliases` 字段，用于 `/help` 标注 canonical 命令与兼容别名。
2. 给 help 元数据增加 `hidden` 字段，支持“真实可执行但默认不进 `/help` 的长尾命令”。
3. 给 `routes.commands.test.ts` 增加一致性锁：
   - `visibleInHelp=true` 的 keyword 必须在帮助文本出现；
   - canonical keyword 必须能被 `isRouteCommand` 命中。

若后续 `cmd-info.ts` 因 help 元数据膨胀得太大，再把这些常量平移到 `command-registry.ts`；在那之前不预设新层。

明确不做：

- 不让 help 元数据直接驱动 handler import；
- 不让 help 元数据承担复杂参数解析；
- 不把 CLI `help-docs` 生拉硬拽并入本轮主链。

## Plan

1. 改造 `src/routes/cmd-info.ts`
   - 新增 `HELP_ENTRIES`
   - 提供 `renderSlashHelpText()` / `getVisibleSlashKeywords()` / `renderUnknownCommandHint()`
   - 删除手写帮助大字符串

2. 改造 `src/routes/commands.ts`
   - 删除 `default` 分支里的手写命令枚举
   - 改为从 `cmd-info.ts` 调用 `renderUnknownCommandHint()`

3. 改造 `scripts/check-doc-sync.ts`
   - 删除“调用 help 再解析文本”的脆弱实现
   - 直接从 `cmd-info.ts` 获取关键字集合
   - 删除 `extras = ["/tts", "/voice", "/mode"]` 这类补丁

4. 补测试
   - `test/routes.commands.test.ts`
   - 如需要，新增 `test/routes.help-docs.test.ts`
   - 如需要，补 `test/docs.sync.test.ts`

## Test Plan

- `npm test -- --runInBand test/routes.commands.test.ts`
- `npm test -- --runInBand test/docs.sync.test.ts`

关键断言：

1. `/help` 文案由 `HELP_ENTRIES` 渲染，不再内嵌长字符串。
2. 未知命令提示由同一份 help 元数据派生，不再手写第二份列表。
3. docs sync 直接读取同一份 help 元数据，不再“解析结果字符串再猜”。

## Risks

- 风险 1：help 元数据与真实 parser/dispatcher 仍可能漂移
  - 缓解：增加“一致性锁”测试，而不是把解析 DSL 化

- 风险 2：把 `help-docs` 也纳入本轮，范围会瞬间放大
  - 缓解：明确边界，本轮只收口群聊 slash 命令的帮助链路

- 风险 3：把 `/desktop`、`/mode` 这类复杂命令硬塞进统一语法模型
  - 缓解：help 元数据只负责文档投影，不负责参数解析

回滚 / 降级策略：

- 回退 `src/routes/cmd-info.ts` 中新增的 help 元数据常量与投影函数
- 恢复 `src/routes/commands.ts` 里的原始手写未知命令提示
- 恢复 `scripts/check-doc-sync.ts` 旧实现

## 评审意见

[留空,用户将给出反馈]
