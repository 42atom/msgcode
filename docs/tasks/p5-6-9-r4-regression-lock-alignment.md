# P5.6.9-R4：CLI 回归锁口径收敛（清退过期锁 + Gate 复绿）

## 背景

`P5.6.9` 本体（Command Runner + Validators + CLI 契约锁）已完成，但全量 `npm test` 出现跨阶段回归锁冲突：

- 旧锁仍断言 `/skill run` 与 `runSkill` 主链（已在 R3e 硬切删除）
- 旧锁仍断言 `/reload` 文案为历史格式（已迁移为新 SOUL 结构字段）
- 结果：`P5.6.9` 局部通过、全量 Gate 不绿，签收口径失真

## 目标（冻结）

1. 回归锁与当前主线语义对齐，不再引用已退役能力
2. 清退/改写过期测试，保留有效防回流锁
3. 恢复全量测试门禁可信度（msgcode 核心全绿 + 白名单策略稳定）

## 实施范围

- `test/p5-6-3-skill-single-source.test.ts`
- `test/p5-6-8-r3d-decoupling-regression.test.ts`
- `test/p5-6-2-r1-regression.test.ts`
- `test/p5-6-7-r6-smoke-static.test.ts`
- `test/*`（受影响断言）
- `docs/tasks/*`

## 实施项

1. 断言分级清点
   - 标记“已过期语义断言”（`/skill run`、`runSkill` 主链）
   - 标记“仍有效断言”（单一执行链、四工具门禁、SOUL 真实注入）
2. 过期锁处理
   - 删除无意义断言
   - 或改为当前语义断言（例如：主链禁止 `/skill run|run_skill` 回流）
3. 文案锁更新
   - `/reload` 仅锁字段语义，不锁历史文案片段
4. Gate 复核
   - 全量 `tsc/test/docs:check`
   - `scripts/test-gate.js` 白名单策略一致

## 验收

- `npx tsc --noEmit` ✅
- `npm test` ✅（msgcode 0 fail；imessage-kit 按白名单）
- `npm run docs:check` ✅
- 过期断言清单与替换映射表提交 ✅

## 非范围

- 不改业务语义（PI、SOUL、memory、tooling）
- 不新增命令面
- 不引入兼容壳
