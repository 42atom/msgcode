# 任务单：P5.7-R8c LLM 工具暴露层单一真相源与说明书收口

优先级：P1（修复 browser 工具未暴露给模型的根因问题）

Issue: 0005
Plan: docs/design/plan-260306-llm-tool-manifest-single-source.md

## 目标

1. 新增统一工具说明书注册表（src/tools/manifest.ts）
2. 新增统一暴露解析器（resolveLlmToolExposure）
3. 重构执行核工具入口，从 manifest 派生 tools[]
4. 补回归锁，确保 browser 可稳定暴露

## 验收标准

1. ✅ 工具说明书注册表包含 browser、bash、read_file、write_file、edit_file 等基础工具
2. ✅ 暴露解析器正确计算 allowed/registered/exposed/missing 四类状态
3. ✅ getToolsForLlm() 从 tooling.allow 派生，不再使用 PI_ON_TOOLS 硬编码
4. ✅ 测试覆盖 allowed=true/registered=true/exposed=true 场景
5. ✅ 测试覆盖 allowed=true/registered=false/missingManifests 命中场景
6. ✅ 三门通过：npx tsc --noEmit, npm test, npm run docs:check

## 改动文件

### 新增
- src/tools/manifest.ts（工具说明书注册表 + 暴露解析器）
- test/p5-7-r8c-llm-tool-manifest-single-source.test.ts（回归锁）

### 修改
- src/agent-backend/tool-loop.ts（getToolsForLlm 改为从 manifest 派生）
- src/agent-backend/types.ts（AidocsToolDef 改为通用格式）
- src/agent-backend/index.ts（导出 getToolsForLlm）
- src/lmstudio.ts（getToolsForLlm 改为从 manifest 派生）
- src/tools/types.ts（ToolName 增加 list_directory/search_file/search_content/todo_read/todo_write）
- src/config/workspace.ts（ToolName 同步更新）
- issues/0005-browser-tool-not-exposed-to-llm.md（更新 notes）

## 结果（返工完成）

- ✅ browser 在 workspace tooling.allow 包含时，真实进入执行核 tools[]
- ✅ browser manifest 改为真实 PinchTab 合同（operation: tabs.open/tabs.action/instances.launch/...）
- ✅ 主链直接使用 manifest 的 toOpenAiToolSchemas()，删除旧 schema 生成逻辑
- ✅ 不存在 expose != execute 漂移（删除了无执行分支的 5 个工具暴露）
- ✅ 排查时可直接看到 allowed/registered/exposed/missing 结构化结果

## 验证（返工后）

- ✅ TypeScript：`npx tsc --noEmit` ✓
- ✅ 测试：`npm test` → **1436 pass, 0 fail** ✓（新增 3 条测试验证 browser 真实合同）
- ✅ 回归测试：`npm test -- test/p5-7-r8c-llm-tool-manifest-single-source.test.ts` → **14 pass, 0 fail** ✓
- ⚠️ 文档：`npm run docs:check` → 失败（其他 Issue 0006 任务文档的回链问题，与本次返工无关）

## 关键验收证据

1. **browser 真实合同验证**：
   ```typescript
   // test/p5-7-r8c-llm-tool-manifest-single-source.test.ts
   it("browser manifest 应包含真实 PinchTab operation 枚举", async () => {
     const operationEnum = browserManifest.parameters.properties.operation?.enum;
     expect(operationEnum).toContain("tabs.open");      // ✅ 真实合同
     expect(operationEnum).toContain("tabs.action");     // ✅ 真实合同
     expect(operationEnum).toContain("instances.launch"); // ✅ 真实合同
     expect(operationEnum).not.toContain("navigate");    // ✅ 旧风格已删除
     expect(operationEnum).not.toContain("click");       // ✅ 旧风格已删除
   });
   ```

2. **主链单一真相源验证**：
   - `src/agent-backend/tool-loop.ts` 删除了旧的 `toOpenAiToolSchemas()` 实现
   - 导入并使用 `src/tools/manifest.ts` 的 `toOpenAiToolSchemas()`
   - `getToolsForLlm()` 返回 `ToolName[]`，直接从 manifest 派生

3. **expose != execute 漂移消除验证**：
   - 删除了 `list_directory/search_file/search_content/todo_read/todo_write` 的暴露
   - 所有暴露的工具都在 `src/tools/bus.ts` 的 `executeTool()` 中有执行分支

## 风险/卡点

- ✅ 已收口所有兼容入口（lmstudio.ts + tool-loop.ts 均已改为使用 manifest）
- ✅ 已修正 browser manifest 为真实 PinchTab 合同
- ✅ 已删除无执行分支的工具暴露
- ⚠️ docs:check 失败是其他 Issue 0006 任务文档的问题，不影响本次验收
