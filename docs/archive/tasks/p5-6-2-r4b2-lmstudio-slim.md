# P5.6.2-R4b2：lmstudio.ts 接口迁移与精简

## 背景

P5.6.2 执行期间尝试精简 lmstudio.ts（目标 < 900 行），但在删除 `parseToolCallBestEffortFromText` 时触发行为漂移：
- lmstudio.ts 导出 `parseToolCallBestEffortFromText(params: {text, allowedToolNames?})`
- providers/tool-loop.ts 提供 `parseToolCallBestEffort(text, allowed: Set<string>)`
- 接口契约不一致导致测试失败

## 目标

1. lmstudio.ts 行数从 1388 降至 < 900 行
2. 零行为漂移（所有现有测试必须通过）

## 实施步骤

### Phase 1: 接口契约测试

1. 编写测试用例验证当前 `parseToolCallBestEffortFromText` 行为
2. 扩展 `providers/tool-loop.ts` 的 `parseToolCallBestEffort` 支持相同格式
3. 验证测试通过后再删除 lmstudio.ts 中的重复实现

### Phase 2: 删除重复实现

1. 确认测试通过后，删除 lmstudio.ts 中的：
   - 内部解析函数（与 tool-loop.ts 重复）
   - 内部工具执行逻辑（复用 tools/bus.ts）
2. lmstudio.ts 仅保留入口编排

## 验收

- [ ] lmstudio.ts < 900 行
- [ ] tsc --noEmit 通过
- [ ] npm test 0 fail
- [ ] npm run docs:check 通过

## 回滚

```bash
git checkout p5.6.2-checkpoint
```
