# test 测试结构说明

## 目录结构

```text
test/
├── *.test.ts   # 回归锁与行为测试（主入口）
└── features/   # BDD 场景测试
```

## 架构决策

1. 测试优先行为断言，避免对源码字符串做脆弱匹配。
2. 回归锁按任务单分层命名（如 `p5-7-r9-t6-*.test.ts`），保持可追踪。
3. gate 以三门为准：`tsc`、`npm test`、`docs:check`。
4. `npm test` 现在只代表 Bun 安全子集，不代表所有运行时路径。
5. 触达 SQLite runtime 的路径，必须走 Node 入口验证。

## 开发规范

1. 新增能力必须补至少 1 条成功路径 + 1 条失败路径行为断言。
2. 禁止新增 `.only` / `.skip`。
3. 失败定位优先输出错误码与合同字段，避免只校验文案文本。
4. 若新增测试会触达 `node:sqlite` / `sqlite-vec` 运行时，不要默认塞进 `bun test`。
5. 运行时源码直跑统一用：`npm run cli:node -- <args>`。

## 开发必读：真实通道回归

1. 飞书真机 smoke 默认基座见：`docs/testing/feishu-live-smoke.md`。
2. 这份测试 README 只负责测试结构与回归约束，不再复制一份通道 smoke 手册。

## 变更日志

1. 2026-02-23：新增本文件，明确测试层结构与回归锁约束。
2. 2026-03-19：飞书 live smoke 基座拆到 `docs/testing/feishu-live-smoke.md`。
