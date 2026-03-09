# Notes: /help 命令单一真相源收口

## Sources

### `src/routes/cmd-info.ts`

- `/help` 是手写多行字符串
- 命令分组、排序、文案全靠人工维护

### `src/routes/commands.ts`

- `isRouteCommand` / `parseRouteCommand` / `handleRouteCommand` 为真实路由薄壳
- 未知命令提示仍是手写命令列表

### `src/handlers.ts`

- `/start`、`/stop`、`/status`、`/snapshot`、`/esc`、`/clear`
- `/mode`、`/tts`、`/voice`
- 说明用户可见命令并不只存在于 routes 层

### `scripts/check-doc-sync.ts`

- 注释写“从注册表提取命令关键字集合”
- 真实实现是调用 `handleHelpCommand()` 再解析文本，并手工补 `extras`
- 这说明“声明上的注册表”与“运行时事实”已经脱节

### `src/cli/help.ts`

- `help-docs` 维护另一套 CLI 合同列表
- 信息更丰富，但命令面与群聊 `/help` 不是同一层

### `docs/release/v2.3.0.md`

- 文档声称 `/help` 已与注册表 100% 一致
- 与当前代码现状不符，属于历史叙事漂移

## Synthesized Findings

### 现状问题

- `/help`、未知命令提示、docs sync、release 叙事不是同一份真相源
- 真实命令和帮助文案之间靠人工同步，维护成本高
- 直接上“全量注册表 + DSL 驱动 parse/dispatch”会过度设计

### 合理收口边界

- 先只收口“群聊 slash 命令的可见元数据”
- 元数据优先内聚在 `src/routes/cmd-info.ts`，不为 help 单独新建大注册表文件
- 让 `/help`、未知命令提示、docs sync 从这份元数据投影
- `parseRouteCommand` / `handleRouteCommand` 先保留现有薄壳，不强行自动生成
