# 任务单：P5.7-R9-T6（`lmstudio` 硬编码语义清理专项）

优先级：P0（主链语义一致性）

## 背景

1. `R9-T4` 已完成中性入口与 API 别名，但主链仍残留大量 `lmstudio` 主语。  
2. 现状会持续误导维护者：能力已多后端化，语义仍“单后端化”。  
3. 用户要求“`lmstudio` 硬编码命名问题要仔细检查，不能马虎”。

## 目标（冻结）

1. 主链语义统一为 `agent-backend` / `agent provider`。  
2. `lmstudio` 仅保留兼容层（明确标注，禁止新依赖）。  
3. 配置与路由默认语义不再把 `lmstudio` 当系统主语。

## 范围

1. `src/router.ts`：`BotType` 与默认路由主语收敛。  
2. `src/handlers.ts`：默认 provider 与日志文案改中性语义。  
3. `src/config/workspace.ts`：默认 provider/runner 文案去 `lmstudio` 主语。  
4. `src/lmstudio.ts`：兼容层注释与导出分层，禁止新增 `LmStudio*` 用法。  
5. `docs/tasks` / 帮助文案：同步中性命名。

## 分步实施（每步一提交）

1. `refactor(p5.7-r9-t6): normalize router and handler backend semantics`  
2. `refactor(p5.7-r9-t6): neutralize workspace config defaults and copywriting`  
3. `refactor(p5.7-r9-t6): isolate lmstudio compatibility surface`  
4. `test(p5.7-r9-t6): add hardcode purge regression locks`  
5. `docs(p5.7-r9-t6): sync naming and compatibility notes`

## 验收门

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`

## 回归锁（必须）

1. 新代码入口不得直接 import `runLmStudio*`。  
2. 运行主链日志不得再使用 `lmstudio` 作为系统主语。  
3. 配置默认语义必须以 `agent-backend` 叙述。  
4. 兼容层清单固定，新增兼容口需单独评审。

## 风险与约束

1. 大量字符串断言测试存在历史包袱，必须优先改行为锁。  
2. 不做一次性暴力替换，按“最小替换 -> 三门验证 -> 扩展替换”推进。  
3. 若出现主链回归，立即停止后续步骤并回滚到前一提交。
