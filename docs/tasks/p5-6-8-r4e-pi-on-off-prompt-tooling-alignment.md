# P5.6.8-R4e：PI on/off 提示词与工具硬门一致性收口

## 背景

当前 `pi.enabled` 已参与工具暴露分叉，但系统提示词与主链接线仍存在漂移风险：

- `pi.off` 需要同时满足“工具不可用”与“提示词禁止调用工具”。
- `pi.on` 需要同时满足“仅四工具可用”与“提示词允许工具调用并给出 skill 使用路径”。

仅靠提示词不可靠，必须采用“双保险”：**工具硬门 + 提示词软门**。

## 目标（冻结）

1. `pi.off`
   - `tools=[]`
   - system 明确：不能调用工具，只能基于上下文与记忆回答
2. `pi.on`
   - `tools=[read_file, write_file, edit_file, bash]`
   - system 明确：可按需调用四工具；skill 仅通过 `read_file + bash` 使用
3. 禁止 `/skill run`、`run_skill` 回流主链

## 实施范围

- `src/handlers.ts`
- `src/lmstudio.ts`
- `test/*`
- `docs/tasks/*`

## 实施项

1. 主链接线修正
   - direct 路径始终透传 `workspacePath` 到 `runLmStudioToolLoop`
   - 不再依赖 MCP 开关决定是否传 `workspacePath`
2. 双保险落地
   - 硬门：根据 `pi.enabled` 决定 tools 暴露
   - 软门：根据 `pi.enabled` 注入 on/off 提示词
3. 回归锁
   - `pi.off`: 断言 `tools=[]`，且提示词包含“不能调用工具”
   - `pi.on`: 断言仅四工具，且提示词包含“可调用四工具”
   - 静态扫描：主链无 `/skill run|run_skill`

## 验收

- `npx tsc --noEmit` ✅
- `npm test` ✅（msgcode 0 fail；imessage-kit 失败按白名单）
- `npm run docs:check` ✅
- `node scripts/test-gate.js` ✅

## 非范围

- 不改 tmux 管道语义
- 不新增命令面
- 不恢复兼容壳
