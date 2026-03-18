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
5. 触达 `better-sqlite3` 的路径，必须走 Node 入口验证。

## 开发规范

1. 新增能力必须补至少 1 条成功路径 + 1 条失败路径行为断言。
2. 禁止新增 `.only` / `.skip`。
3. 失败定位优先输出错误码与合同字段，避免只校验文案文本。
4. 若新增测试会触达 SQLite native addon，不要默认塞进 `bun test`。
5. 运行时源码直跑统一用：`npm run cli:node -- <args>`。

## 开发必读：真实通道回归

1. 飞书真机 smoke 默认使用已有 `test-real` 群。
2. 默认 workspace：`/Users/admin/msgcode-workspaces/test-real`。
3. 默认凭据来源：`~/.config/msgcode/.env`。
4. 默认流程：`msgcode preflight` → `msgcode start` → 在 `test-real` 群发真实测试消息。
5. 默认方法论真相源：`docs/plan/pl0098.dne.feishu.feishu-live-verification-loop.md`。
6. 若测 skill / browser / file 回传，先检查 `test-real/.msgcode/config.json` 的 `tooling.allow`。

## 变更日志

1. 2026-02-23：新增本文件，明确测试层结构与回归锁约束。
