# 任务单：P5.7-R3i（文件权限策略分层）

优先级：P0（远程真实可用性阻塞）

## 目标（冻结）

1. 文件工具权限从硬编码升级为策略可配置。
2. 支持两种模式：
   - `workspace`：仅工作区内（默认安全）
   - `unrestricted`：允许绝对路径全盘读写（你当前诉求）
3. 保持 `agent/tmux` 边界：`agent` 执行策略可控，`tmux` 继续忠实透传。

## 范围

- `src/config/workspace.ts`
- `src/tools/bus.ts`
- `src/lmstudio.ts`（如需透传策略）
- `test/*p5-7-r3i*.test.ts`（新增）
- `docs/tasks/*.md`（口径同步）

## 非范围

1. 不改工具命令名。
2. 不改 run_skill 退役口径。
3. 不改浏览器/desktop 工具权限。

## 配置合同（冻结）

1. `tooling.fs_scope = workspace | unrestricted`
2. 缺省值：`workspace`
3. 生效工具：`read_file/write_file/edit_file`

## 实施步骤（每步一提交）

### R3i-1：配置扩展

提交建议：`feat(p5.7-r3i): add fs scope policy in workspace config`

1. 增加配置读取写入与默认值。
2. 补齐类型定义，禁止 `any` 回流。

### R3i-2：Tool Bus 策略接线

提交建议：`feat(p5.7-r3i): apply fs scope policy to file tools`

1. `workspace` 模式维持现有边界校验。
2. `unrestricted` 模式放开路径限制。
3. 错误码保持兼容。

### R3i-3：观测字段

提交建议：`feat(p5.7-r3i): add fs scope observability fields`

1. 日志输出 `fsScope`。
2. 失败日志包含 `path` 与 `policy`。

### R3i-4：回归锁

提交建议：`test(p5.7-r3i): add fs scope policy regression lock`

1. workspace 模式越界拒绝测试。
2. unrestricted 模式绝对路径通过测试。
3. 两模式切换一致性测试。

## 硬验收

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `workspace/unrestricted` 两模式行为可复现
5. 无新增 `.only/.skip`

## 验收回传模板

```md
# P5.7-R3i 验收报告

## 提交
- <sha> <message>

## Gate
- npx tsc --noEmit:
- npm test:
- npm run docs:check:

## 关键证据
- workspace mode denied:
- unrestricted mode allowed:
- fsScope log fields:
```
