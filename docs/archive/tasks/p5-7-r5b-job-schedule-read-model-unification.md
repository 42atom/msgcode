# 任务单：P5.7-R5b（Job/Schedule 读模型统一）

优先级：P1（R5 后续技术债）

## 背景

1. `R5` 后存在双存储语义：  
   - `schedule`：workspace-local 文件（`.msgcode/schedules/*.json`）  
   - `job`：全局 `jobs.json`
2. 写路径分离是合理的，但读路径分裂会导致观测和排障成本上升。

## 目标

1. 保持“写隔离”：`schedule` 继续写 workspace 文件。  
2. 统一“读模型”：对外查询可见同一逻辑视图。  
3. 保持现有 CLI 合同不破坏。

## 方案（冻结）

1. 引入读模型适配层（聚合 `schedules/*.json` 与 `jobs.json`）。  
2. `schedule add/remove` 后同步投影到统一读索引。  
3. 查询命令优先读统一视图，必要时回退源文件核验。

## 实施步骤（每步一提交）

1. `feat(p5.7-r5b): add unified schedule-job read model adapter`  
2. `feat(p5.7-r5b): sync projection on schedule add/remove`  
3. `test(p5.7-r5b): add read-model consistency regression locks`  
4. `docs(p5.7-r5b): sync contracts and read-path semantics`

## 验收门

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`

## 回归锁

1. 同一 schedule 在 `schedule list` 与 `job` 视图中语义一致。  
2. 删除后两侧都不可见。  
3. workspace 隔离不被破坏。  
4. 错误码合同保持稳定（不得新增伪成功）。

## 非范围

1. 不重写 daemon 调度器。  
2. 不改变 `R5` 已冻结 CLI 参数与输出结构。  
3. 不迁移历史数据格式（仅做读取适配与投影同步）。
