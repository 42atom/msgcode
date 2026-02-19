# P5.6.9：CLI 命令执行层收口（Command Runner + Validator）

## 背景

审查结论明确：`src/index.ts` 与 `src/cli.ts` 结构健康，主要技术债集中在 CLI 子命令实现层。  
当前 `src/cli/run.ts`、`src/cli/jobs.ts`、`src/cli/memory.ts` 存在重复“胶水逻辑”：

- `Envelope` 构造重复
- `try/catch + 错误码转换 + JSON/Text 输出 + exit` 重复
- workspace 路径解析与存在性校验重复

这类重复不会立刻导致故障，但会持续放大维护成本与行为漂移风险。

## 目标

1. 建立 CLI 执行单一真相源：统一 runner 负责耗时统计、输出封装、错误映射、退出码。
2. 建立统一校验入口：workspace 解析与存在性检查复用。
3. 迁移 `run/jobs/memory` 到统一骨架，清理重复模板代码。
4. 保持零语义变更（命令输入、输出结构、错误码语义不变）。

## 范围

- `src/cli/run.ts`
- `src/cli/jobs.ts`
- `src/cli/memory.ts`
- `src/cli/_shared/command-runner.ts`（新增）
- `src/cli/_shared/validators.ts`（新增）
- `test/*`（CLI 契约回归锁）
- `docs/tasks/README.md`（索引同步）

## 非范围

- 不改 `src/index.ts`、`src/cli.ts` 启动与分发职责
- 不新增 CLI 功能
- 不改 SOUL/Memory/ToolLoop 业务语义

## 实施步骤

### R1：抽统一执行器（P0）

新增 `command-runner.ts`，收敛以下通用逻辑：

- `startTime`/`durationMs`
- `Envelope` 构造
- `status -> exitCode` 映射
- JSON/Text 输出分流
- 统一异常兜底与退出

### R2：抽统一校验器（P0）

新增 `validators.ts`，收敛：

- workspace 标签/路径解析
- 目录存在性检查
- 输入文件存在性检查（按命令可选）

### R3：迁移三类命令（P0）

迁移顺序（低风险到高风险）：

1. `run.ts`
2. `jobs.ts`
3. `memory.ts`

迁移原则：每迁移一个文件，立即删除对应重复逻辑，避免双实现并存。

### R4：契约回归锁（P0）

补测试锁定：

- 相同输入下 Envelope 字段一致（`schemaVersion/command/status/exitCode`）
- JSON/Text 输出语义一致
- 错误码映射一致（workspace 不存在、输入缺失、运行异常）

## 硬验收

| 验收项 | 命令/检查 | 结果 |
|---|---|---|
| TypeScript 编译 | `npx tsc --noEmit` | ✅ |
| 单元/集成测试 | `npm test`（0 fail） | ✅ |
| 文档同步检查 | `npm run docs:check` | ✅ |
| 重复度收口 | `run/jobs/memory` 不再手写同类 runner 模板 | ✅ |
| 契约稳定性 | CLI 回归锁通过 | ✅ |

## 风险与约束

- 风险：CLI 输出细节可能因封装重构发生微漂移。
- 约束：必须通过契约测试锁定，禁止“看起来差不多”。
- 约束：不做行为优化，不做文案重写，不做参数语义调整。

## 交付物

- 迁移映射表（旧逻辑 -> `command-runner`/`validators`）
- 三门验收日志
- 回归锁清单（新增测试项）
