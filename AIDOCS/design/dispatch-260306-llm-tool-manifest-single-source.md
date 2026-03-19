# 任务单：LLM Allowed Tools 单一真相源与说明书收口

## 结论

本轮不是修 `browser` runner，也不是继续堆 prompt。  
本轮只做一件事：把“给 AI 的工具说明书”收口为单一真相源，并让执行核从该真相源派生 `tools[]`。

## 唯一真相源

- Issue：`issues/tk0005.dne.browser.browser-tool-not-exposed-to-llm.md`
- Plan：`docs/plan/pl0005.dne.browser.llm-tool-manifest-single-source.md`
- Dispatch：`AIDOCS/design/dispatch-260306-llm-tool-manifest-single-source.md`

若实现过程发现与旧代码冲突，以 Issue + Plan 当前内容为准，不以历史硬编码白名单为准。

## 本轮范围

必须实现：

1. 新增统一工具说明书注册表
   - 建议文件：`src/tools/manifest.ts`
2. 新增统一暴露解析器
   - 产出 `allowed / registered / exposed / missing` 四类结构化结果
3. 重构执行核工具入口
   - `src/agent-backend/tool-loop.ts`
   - `src/agent-backend.ts`
   - `src/agent-backend/types.ts`
   - `src/lmstudio.ts`（如仍存在兼容入口）
4. 补测试，锁住 `browser` 暴露问题
5. 回写 issue notes

允许顺带修改：

1. `src/tools/types.ts`
2. `README.md` 或最小 docs，同步说明“工具说明书单一真相源”
3. 相关日志字段，只要不扩成新功能

## 非范围 / 禁止扩 scope

本轮禁止实现：

1. browser runner 新能力
2. web/news 自然语言强绑定策略
3. 新 CLI 命令面大扩张
4. tool bus 大重写
5. prompt 大改
6. 新 provider 适配

## 实现顺序

1. 先建立 manifest registry
   - 每个工具一条说明书
   - 最低覆盖：`browser`、`bash`、`read_file`、`write_file`、`edit_file`

2. 再建立 exposure resolver
   - 输入：workspace `tooling.allow`
   - 输出：`allowedTools`、`registeredTools`、`exposedTools`、`missingManifests`

3. 再改执行核
   - 删除 `PI_ON_TOOLS` 作为 LLM 暴露清单的职责
   - 执行核发给模型的 `tools[]` 必须只来自 exposure resolver

4. 最后补回归锁
   - `browser` 允许时必须出现在 `tools[]`
   - 未允许时不能暴露
   - 允许但未注册时必须给出结构化缺失证据

## 硬验收

1. `browser` 在 workspace `tooling.allow` 包含时，真实进入执行核 `tools[]`
2. 不再存在独立硬编码白名单决定 LLM 工具暴露
3. 至少有一条测试明确验证：
   - `allowed = true`
   - `registered = true`
   - `exposed = true`
4. 至少有一条测试明确验证：
   - `allowed = true`
   - `registered = false`
   - `missingManifests` 命中
5. 三门通过：
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run docs:check`
6. 无新增 `.only/.skip`

## 已知坑

1. 不要把 `tooling.allow` 直接塞成最终数组；配置和说明书要分层
2. 不要继续让 `PI_ON_TOOLS` 承担“暴露给模型”的职责
3. 不要只修 `src/agent-backend/tool-loop.ts`，遗漏 `src/lmstudio.ts` 等兼容入口
4. 不要只测 Tool Bus；这次问题发生在“暴露给模型”层，不在执行层

## 交付格式

执行完成后，回传必须使用以下结构：

任务：LLM Allowed Tools 单一真相源与说明书收口
原因：
- 现状存在 `allow != expose` 漂移
- `browser` 已允许但未暴露给模型
过程：
- 新增工具说明书注册表
- 新增统一暴露解析器并接入执行核
- 补回归锁并跑三门验证
结果：
- `browser` 等允许工具可稳定暴露给模型
- 排查时可直接看到 `allowed / registered / exposed / missing`
验证：
- 列出三门命令与关键输出
- 列出至少一条 `browser` 暴露成功的测试证据
风险 / 卡点：
- 说明是否仍存在旧兼容入口未收口
后续：
- 若需要，再做“网页/新闻 -> browser/web”自然语言强绑定

## 给执行同学的一句话

先把“说明书单一真相源”收口，别急着继续调 prompt；这次先修模型看不到工具的问题。
