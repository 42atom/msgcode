# routes 架构说明

## 目录结构

```text
src/routes/
├── commands.ts       # 路由薄壳：识别 + 解析 + 分发
├── cmd-types.ts      # 共享类型：CommandResult / CommandHandlerOptions
├── cmd-bind.ts       # /bind /where /unbind
├── cmd-info.ts       # /help /info /chatlist
├── cmd-model.ts      # /model /policy /pi
├── cmd-owner.ts      # /owner /owner-only
├── cmd-memory.ts     # /cursor /reset-cursor /mem
├── cmd-soul.ts       # /soul list/use/current
├── cmd-schedule.ts   # /schedule* /reload
├── cmd-tooling.ts    # /toolstats /tool allow *
├── cmd-desktop.ts    # /desktop *
├── cmd-steer.ts      # /steer /next
└── store.ts          # 群聊绑定存储（RouteStore）
```

## 职责边界

- `commands.ts` 只保留三段薄壳：`isRouteCommand` / `parseRouteCommand` / `handleRouteCommand`。
- `cmd-*.ts` 每个文件按命令域负责具体业务逻辑，禁止反向依赖 `commands.ts`。
- `cmd-types.ts` 是类型单一出口，避免模块循环依赖。
- `store.ts` 仅负责路由数据读写，不承载命令语义。

## 变更规则

- 新增命令时必须同步修改三段：识别、解析、分发。
- 迁移命令域后，必须删除 `commands.ts` 旧实现，不保留双实现。
- 任何命令面变更都要更新 `test/routes.commands.test.ts` 与相关回归锁。
