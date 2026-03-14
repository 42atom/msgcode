# P5.6.1-R2A：Persona 残留注释清理（零行为变更）

## 背景

`P5.6.1-R2` 已完成 persona 退役，但代码中仍有少量 persona 相关注释/注释掉的旧代码，容易造成误读与回流。

## 目标

1. 清理 persona 退役后的注释残留与死注释代码。
2. 保持运行时行为 100% 不变。
3. 增加最小回归锁，防止 persona 文案回流。

## 范围

- `src/handlers.ts`（删除 persona 相关注释残留）
- `src/routes/commands.ts`（删除 persona 相关注释残留）
- `test/persona-retirement-lock.test.ts`（按需补锁）

## 非范围

- 不恢复 /persona
- 不修改 SOUL 逻辑
- 不修改工具/路由行为

## 实施项

1. 删除 `from "./config/personas.js"` 等注释残留。
2. 删除 `getActivePersonaContent` 等旧逻辑注释块。
3. 删除 `/reload` 中 persona 扫描历史注释。
4. 若有需要，补充锁定断言：`src` 中不应再出现 `config/personas` 与 `/persona` 文案（测试文件除外）。

## 硬验收

| 验收项 | 命令/检查 | 结果 |
|---|---|---|
| TypeScript 编译 | `npx tsc --noEmit` | ✅ |
| 单元/集成测试 | `npm test`（0 fail） | ✅ |
| 文档同步检查 | `npm run docs:check` | ✅ |
| 残留扫描 | `rg -n "config/personas|/persona" src` 无命中 | ✅ |

## 回滚

```bash
git checkout -- src/handlers.ts src/routes/commands.ts test/persona-retirement-lock.test.ts
```
