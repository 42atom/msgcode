# P5.6.8-R4a：SOUL 运行时真读取闭环

## 背景

当前 SOUL 存在两处问题：

1. `src/config/souls.ts` 仍是占位实现（固定返回 default）。
2. `/reload` 的 workspace SOUL 路径与当前工作区规范不一致。

这会导致 `SOUL 已发现` 与真实注入行为不一致，影响 direct 管道验收。

## 目标

让 SOUL 成为 direct 管道可验证的真输入源：

- workspace 优先：`<workspace>/.msgcode/SOUL.md`
- global 兜底：`~/.config/msgcode/souls/**`
- `/reload` 回执必须反映真实来源与条目数

## 实施范围

- `src/config/souls.ts`
- `src/routes/cmd-schedule.ts`（`/reload` 输出）
- `src/routes/cmd-soul.ts`（仅必要同步）
- 相关测试

## 实施项

1. 替换占位读取逻辑：
   - `listSouls()` 真实扫描全局 SOUL 目录
   - `getActiveSoul()/setActiveSoul()` 真实读写 `active.json`
2. 增加 workspace SOUL 读取入口：
   - 新增或复用函数读取 `<workspace>/.msgcode/SOUL.md`
3. 修正 `/reload` 输出口径：
   - `SOUL: workspace=...` 使用 `.msgcode/SOUL.md` 真路径
   - `SOUL Entries` 使用真实统计
4. 回归锁：
   - workspace/global 路径优先级
   - active 切换持久化

## 验收

- `npx tsc --noEmit` ✅
- `npm test`（0 fail）✅
- `npm run docs:check` ✅
- `/reload` 显示的 SOUL 路径与实际文件一致（`.msgcode/SOUL.md`）

## 非范围

- 不改 tmux 管道语义
- 不引入新命令
