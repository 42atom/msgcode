# 任务单：P5.7-R3（文件与环境域：file + system env）

优先级：P0（P5.7 主线下一站）

## 目标（冻结）

1. 按 Unix 风格落地 `file` 域核心原子命令：
   - `msgcode file find`
   - `msgcode file read`
   - `msgcode file write`
   - `msgcode file move`
   - `msgcode file rename`
   - `msgcode file delete`
   - `msgcode file copy`
   - `msgcode file zip`
2. 补充 `system` 域只读命令：`msgcode system env`。
3. 强制执行 workspace 默认边界：越界读写/变更必须显式 `--force`。
4. 所有命令进入 `msgcode help-docs --json` 合同。

## 依赖与顺序（冻结）

1. 先 `file find`（纯读、最低风险）
2. 再 `file read`（引入 `--force` 越界口径）
3. 再 `file write`（引入 `--append` 与越界口径）
4. 最后 `move/rename/delete/copy/zip`（状态变更组，统一回归锁）

## 设计口径（单一真相）

1. 返回协议统一 Envelope（沿用现有 schemaVersion=2 / status=pass|warning|error）。
2. 成功载荷写在 `data`，失败必须包含固定 `errorCode`。
3. 破坏性命令（delete/move/rename/copy/zip）默认禁止越界，越界必须 `--force`。
4. 禁止聚合黑盒命令（不引入 `file manage`）。

## 范围

- `/Users/admin/GitProjects/msgcode/src/cli/file.ts`
- `/Users/admin/GitProjects/msgcode/src/cli/system.ts`
- `/Users/admin/GitProjects/msgcode/src/cli/help.ts`
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r3*`
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`

## 非范围

1. 不改 memory/thread/todo/schedule。
2. 不改 tmux/agent 主链。
3. 不改 skill 编排策略。

## 执行步骤（每步一提交）

### R3-1：find/read

提交建议：`feat(p5.7-r3): add file find and file read`

1. 实现 `file find`。
2. 实现 `file read`（含 `--force` 越界口径）。

### R3-2：write

提交建议：`feat(p5.7-r3): add file write with append and force`

1. 实现 `file write --content`。
2. 支持 `--append`。
3. 越界写入必须显式 `--force`。

### R3-3：状态变更组

提交建议：`feat(p5.7-r3): add file move rename delete copy zip`

1. 实现 `move/rename/delete/copy/zip`。
2. 统一错误码与非 0 退出码。

### R3-4：system env + 合同同步

提交建议：`feat(p5.7-r3): add system env and sync help-docs contracts`

1. 实现 `system env`。
2. 更新 `help-docs --json` 合同。

### R3-5：回归锁

提交建议：`test(p5.7-r3): add file-domain regression lock`

1. 命令存在性。
2. 参数校验。
3. workspace 越界与 `--force`。
4. 成功/失败路径。

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `help-docs --json` 含全部 R3 命令合同
5. 真实成功证据：至少 2 条（1 条只读、1 条状态变更）
6. 真实失败证据：至少 2 条（越界未加 force / 参数缺失）
7. 无新增 `.only/.skip`

## 验收回传模板（固定口径）

```md
# P5.7-R3 验收报告（file + system env）

## 提交
- <sha> <message>

## Gate
- npx tsc --noEmit:
- npm test:
- npm run docs:check:

## 合同证据
- help-docs --json:

## 真实链路证据（非 mock）
- 成功:
- 失败:

## 风险与遗留
- 风险:
- 遗留:
```
