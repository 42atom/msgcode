# P5.5：Skill 编排主线收敛（LLM 决策 + `tool_calls(run_skill)`）

## 背景

当前存在关键词触发、文本协议触发与手动命令触发并存，执行路径分裂。  
本任务只收敛主线：让 LLM 在标准 `tool_calls` 中决定是否调用 `run_skill`，并统一执行器。

## 冻结决策（已确认）

1. 主路径只认标准 `tool_calls`，不再以文本协议作为主链触发。
2. 自然语言触发与 `/skill run` 必须共用同一执行器（单一真相源）。
3. 暂不引入 `src/abilities/`（避免过早抽象与耦合）。
4. Skill 提示层只注入简要索引（id/description/场景），由 LLM 自主编排。
5. 默认 `autonomous`（测试期）为主口径。

## 目标

1. 自然语言请求可由 LLM 自主触发 `run_skill`。
2. `/skill run` 仅调试入口，但执行链与主路径一致。
3. 日志可观测：`autoSkill` / `autoSkillResult` / `toolCallCount`。
4. 删除关键词主触发依赖（可保留临时兼容，但不得走主链）。

## 范围

- `src/lmstudio.ts`（工具定义 + tool loop）
- `src/handlers.ts`（主链接线）
- `src/skills/*`（统一执行器）
- `src/routes/*`（`/skill run` 保留调试口径）
- `test/*`（一致性与回归锁）

## 非范围

- 不做 provider 架构改造
- 不做 UI/按钮层
- 不新增 abilities 层

## 实施拆分

### P5.5.1 `run_skill` 标准工具接线

- 在 tool schema 中加入 `run_skill`（`skill_id:string`、`input?:string`）。
- `run_skill` 执行失败返回结构化错误，不吞错误。

### P5.5.2 单一执行器收敛

- 新增/收口 `executeSkill(...)`（或等价函数）作为唯一执行入口。
- `tool_calls(run_skill)` 与 `/skill run` 都调用同一个入口。

### P5.5.3 主链触发口径收敛

- 自然语言主链由 LLM 决策是否调用 `run_skill`。
- 文本协议触发（如 `[建议激活 Skill: ...]`）退出主链。

### P5.5.4 观测与回归锁

- 日志新增：`autoSkill`、`autoSkillResult`、`toolCallCount`。
- 补充一致性测试：自然语言触发结果与 `/skill run` 一致。

## 硬验收

| 验收项 | 命令/检查 | 结果 |
|---|---|---|
| TypeScript 编译 | `npx tsc --noEmit` | ✅ |
| 单元/集成测试 | `npm test`（0 fail） | ✅ |
| 文档同步检查 | `npm run docs:check` | ✅ |
| 主链触发 | 自然语言“汇报系统配置”触发 `run_skill(system-info)` | ✅ |
| 一致性 | `/skill run system-info` 与自然语言触发结果一致 | ✅ |
| 可观测性 | 日志含 `autoSkill/autoSkillResult/toolCallCount` | ✅ |

## 回滚

```bash
git checkout -- src/lmstudio.ts src/handlers.ts src/skills src/routes test
```
