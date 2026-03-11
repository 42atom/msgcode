# 任务单：P5.7-R9-T7（`lmstudio.ts` 兼容壳化 + agent-backend 核心拆分）

优先级：P0（主链稳定性与可维护性）

状态：🚧 执行中（已派单）
Issue: `issues/0002-r9-t7-agent-backend-core-extraction.md`  
Plan: `docs/design/plan-260223-r9-t7-agent-backend-core-extraction.md`

## 背景

1. `R9-T6` 已完成主语收敛，但 `src/lmstudio.ts` 仍承担过多职责（配置解析、提示词拼装、路由、tool loop、兼容导出）。
2. 当前文件体量与耦合度高，属于典型 God Object，后续任何后端扩展都容易引发回归。
3. 用户要求继续沿 Unix 理念推进：单一职责、边界清晰、文件即接口。

## 目标（冻结）

1. `src/lmstudio.ts` 降级为兼容层（薄封装 + re-export），不再承载业务主实现。
2. agent-backend 主链拆分为可测试模块：配置层、提示词层、执行层、编排层。
3. 新增行为锁，禁止新代码回流依赖 `runLmStudio*` 入口。

## 范围

1. `src/agent-backend.ts`（中性入口，保留）
2. 新增目录：`src/agent-backend/`（核心实现）
3. `src/lmstudio.ts`（兼容层保留，业务实现迁出）
4. `src/handlers.ts` / `src/providers/*`（调用点保持 `runAgent*` 语义）
5. `test/*r9-t7*`（新增回归锁）
6. `docs/tasks/*` + 必要 README（文档同步）

## 目标结构（冻结）

```text
src/agent-backend/
├── config.ts            # 后端配置解析与 provider 选择
├── prompt.ts            # Dialog/Exec 提示词构造
├── tool-loop.ts         # 工具循环与 action journal
├── routed-chat.ts       # no-tool/tool/complex-tool 编排入口
└── types.ts             # AgentChatOptions/Result 等类型
```

约束：

1. `src/lmstudio.ts` 只保留兼容导出与注释，禁止新增主链逻辑。
2. 单文件体量控制：新增文件不超过 800 行；`src/lmstudio.ts` 收敛到兼容壳体量（目标 ≤ 300 行）。

## 分步实施（每步一提交）

1. `refactor(p5.7-r9-t7): extract agent backend core module skeleton`
2. `refactor(p5.7-r9-t7): migrate config and prompt builder out of lmstudio`
3. `refactor(p5.7-r9-t7): migrate tool loop and routed chat to core modules`
4. `test(p5.7-r9-t7): add compatibility and no-backflow regression locks`
5. `docs(p5.7-r9-t7): sync architecture and compatibility notes`

## 验收门

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`

## 回归锁（必须）

1. 新入口锁：业务代码只允许 import `runAgent*`，禁止新增 `runLmStudio*` 调用。
2. 兼容层锁：`src/lmstudio.ts` 仅允许 re-export/兼容注释，不得包含工具循环主逻辑。
3. 结构锁：`runAgentRoutedChat` / `runAgentToolLoop` 行为不变（温度锁、模型路由锁、actionJournal 锁）。
4. 文件规模锁：`src/lmstudio.ts` 行数不得回升到核心实现级别。

## 风险与约束

1. 高风险重构，必须遵循“最小迁移 + 全量回归 + 再迁移”节奏，禁止一次性大爆改。
2. 历史源码字符串断言较多，迁移时优先改行为锁，避免无效失败。
3. 若出现 tool loop 回归（R1/R2 失败、伪执行透传、actionJournal 丢失），立即停线修复，不得继续拆分。

## 派单执行口径

1. 每步提交后必须附三门结果与关键证据。
2. 验收报告必须包含：
   - 提交列表
   - 变更文件清单
   - 关键行为证据（至少 3 条）
   - 风险与未完成项
