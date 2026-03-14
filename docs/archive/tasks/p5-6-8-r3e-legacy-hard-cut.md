# P5.6.8-R3e：遗留硬切（与过去告别）

## 目标

在 R3 完成后立即做一次“无兼容壳硬切”，防止历史语义回流：

- 删除 `/skill run` 命令面
- 删除 `run_skill` 主链痕迹
- 删除旧工具暴露名 `list_directory/read_text_file/append_text_file`

## 约束

- 不做灰度保留
- 不保留调试入口
- 不引入双语义文案

## 实施范围

- `src/routes/commands.ts`
- `src/routes/cmd-info.ts`
- `src/lmstudio.ts`
- `src/runtime/skill-orchestrator.ts`
- `test/*`
- `docs/*`

## 实施项

1. 命令面硬切：移除 `/skill run` 的识别、解析、分发、帮助文案。
2. 工具面硬切：移除 `run_skill` 与旧三工具名暴露。
3. 测试锁：新增 anti-regression，扫描上述关键词在主链文件零命中。
4. 文档锁：README 与任务单统一“技能=skill 文件 + bash/read_file 自主调用”。

## 验收

- `npx tsc --noEmit` ✅
- `npm test`（0 fail）✅
- `npm run docs:check` ✅
- `rg "/skill run|run_skill|list_directory|read_text_file|append_text_file" src/routes src/lmstudio.ts docs` 仅允许任务文档命中

## 回滚

- 不回滚到兼容壳
- 如失败，只允许最小修复后继续硬切
