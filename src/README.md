# src 架构说明

## 目录结构

```text
src/
├── cli/             # 命令合同与 CLI 子命令实现
├── routes/          # iMessage 路由命令层（bind/model/policy/...）
├── runtime/         # 运行时编排（会话、调度、路由决策）
├── providers/       # 后端适配层（OpenAI-compatible / ToolLoop 适配）
├── tools/           # Tool Bus 与工具执行网关
├── memory/          # 长短期记忆注入、索引、检索
├── runners/         # 执行器与多媒体/系统 runner
├── routing/         # 路由分类器与策略函数
├── config/          # workspace/config 读取与写回
├── logger/          # 结构化日志与传输
├── output/          # 输出协议与清洗
├── probe/           # preflight/健康检查探针
├── skills/          # skill 索引与装配
├── tmux/            # tmux client 管道
├── state/           # 轻量状态存储
├── agent-backend.ts # 中性后端入口（主入口）
└── lmstudio.ts      # 兼容层（历史别名，逐步壳化）
```

## 架构决策

1. 双管道分离：`agent` 承载智能体能力，`tmux` 只做透传执行。
2. 中性主语优先：新代码入口统一走 `agent-backend`，`lmstudio` 仅保留兼容语义。
3. Tool 单一真相源：工具调用统一经 `tools/bus.ts`，避免多入口漂移。
4. 会话可持续：window + summary + memory 三层并行，支持预算感知与 compact。

## 开发规范

1. 新业务能力优先放入分层目录，避免继续扩展根级大文件。
2. 新增入口函数必须补行为锁测试，禁止只做源码字符串断言。
3. 涉及目录职责变更时，必须同步更新当前文件与对应子目录 `README.md`。
4. 兼容层新增导出需标注用途与退役条件，避免“临时兼容”永久化。

## 变更日志

1. 2026-02-23：新增本文件，统一 `src` 分层视图与开发约束。

