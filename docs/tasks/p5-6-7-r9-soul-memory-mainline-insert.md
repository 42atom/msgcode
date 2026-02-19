# P5.6.7-R9：P0 插单（SOUL 路径与注入闭环、窗口读链路接线）

## 背景

运行时测试反馈两处主链缺口：

1. SOUL 路径与注入链路不一致（`/reload` 可观测与模型实际注入未闭环）。
2. 短期记忆窗口存在读写代码，但 ToolLoop 主链未完成“读取参与构造上下文”的闭环。

本单作为 `P5.6.7` 的 P0 插单，优先于后续优化项。

## 目标

- SOUL 路径规则统一（工作区路径与文档口径一致）。
- SOUL 内容真实注入到 direct 主链模型请求。
- 短期窗口读取结果参与 ToolLoop 上下文构造（非仅写回）。

## 范围

- `src/config/souls.ts`
- `src/routes/cmd-schedule.ts`
- `src/handlers.ts`
- `src/lmstudio.ts`
- 相关回归测试

## 实施项

1. 统一 SOUL 路径口径（workspace 与 global 的优先级、查找位置、日志输出一致）。
2. 在 direct 主链注入 SOUL 内容（保持 tmux 管道零业务注入约束不变）。
3. 打通窗口读链路：`loadWindow` 结果进入 ToolLoop 输入。
4. 补回归锁：SOUL 路径、SOUL 注入、窗口读链路。

## 验收

- `npx tsc --noEmit` 通过
- `npm test` 0 fail
- `npm run docs:check` 通过
- 三工作区集成验证（`medicpass` / `charai` / `game01`）可复现

## 非范围

- 不调整权限策略
- 不改 tmux 忠实转发语义
- 不新增新命令面
