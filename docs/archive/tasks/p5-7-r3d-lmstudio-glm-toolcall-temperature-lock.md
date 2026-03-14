# 任务单：P5.7-R3d（LM Studio GLM ToolCall 温度锁定）

优先级：P0
状态：已完成

## 目标（冻结）

1. 固化 GLM 在 LM Studio 工具调用链路的可用参数口径：`temperature=0`。
2. 禁止工具调用主链使用 `temperature>0` 的漂移配置。
3. 建立回归锁，防止后续参数回退导致"模型不触发工具"。

## 背景结论（R3c 输入）

1. `huihui-glm-4.7-flash-abliterated-mlx`
   - `temperature=0`：R1 `12/12` 命中 tool_calls
   - `temperature=0.2`：R1 `0/10` 命中 tool_calls
2. `glm-4.7-flash-mlx`
   - `temperature=0`：R1 `10/10` 命中 tool_calls
   - `temperature=0.2`：R1 `1/10` 命中 tool_calls

结论：温度与 R1 命中率强相关，工具调用主链必须锁零温。

## 范围

- `src/lmstudio.ts`（工具调用主链已锁定 temperature=0）
- `src/providers/openai-compat-adapter.ts`（请求体构建器）
- `test/p5-7-r3d-toolcall-temperature-lock.test.ts`（新增回归锁）
- `docs/tasks/p5-7-r3d-lmstudio-glm-toolcall-temperature-lock.md`（本文档）

## 非范围

1. 不改 tmux 链路。
2. 不改 vllm-metal 兼容性问题。
3. 不引入新的模型供应商切换逻辑。

## 执行步骤（每步一提交）

### R3d-1: param-freeze（已完成）

代码核查结论：
- `src/lmstudio.ts:327` - `runLmStudioChatNativeMcp` 已锁定 `temperature: 0`
- `src/lmstudio.ts:420` - `runLmStudioChatNative` 已锁定 `temperature: 0`
- `src/lmstudio.ts:1348` - `runLmStudioToolLoop` R1 已锁定 `temperature: 0`
- `src/lmstudio.ts:1439` - `runLmStudioToolLoop` R2 已锁定 `temperature: 0`

**结论：代码已正确锁定温度为 0，无需修改。**

### R3d-2: regression-lock（已完成）

新增回归测试文件：`test/p5-7-r3d-toolcall-temperature-lock.test.ts`

测试覆盖：
1. 工具调用请求体必须包含 `temperature=0`
2. R1（第一轮工具调用）场景温度锁定验证
3. R2（第二轮回答）场景温度锁定验证
4. temperature 未定义时不应包含在请求体中
5. 防止 temperature>0 漂移的防御性测试

测试结果：5 pass, 0 fail

### R3d-3: doc-sync（已完成）

本文档回填完成。

## 硬验收

1. `npx tsc --noEmit`: **PASS**
2. `npm test`: **775 pass, 0 fail**
3. `npm run docs:check`: **PASS**
4. 回归锁：
   - 工具调用场景请求参数带 `temperature=0` ✓
   - 无新增 `.only/.skip` ✓

## 验收回传模板（固定）

```md
P5.7-R3d 验收报告

提交:
- <待提交 SHA> feat(p5.7-r3d): add tool call temperature lock regression tests

变更文件:
- test/p5-7-r3d-toolcall-temperature-lock.test.ts（新增）
- docs/tasks/p5-7-r3d-lmstudio-glm-toolcall-temperature-lock.md（更新）

Gate:
- npx tsc --noEmit: pass
- npm test: 775 pass, 0 fail
- npm run docs:check: pass

关键证据:
- tool call 请求体 temperature=0（src/lmstudio.ts:1348, 1439）
- 回归测试：test/p5-7-r3d-toolcall-temperature-lock.test.ts（5 pass）
```

