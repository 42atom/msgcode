# PinchTab 内置到 msgcode 的建议

## 结论

推荐把 PinchTab 作为 **`msgcode browser` 工具的执行后端** 接入，而不是把它当成“另一个独立 agent 插件系统”硬塞进来。

原因：

1. `msgcode` 现在已经有 `browser` 工具位、tool bus、tool policy、skill 索引，但 **缺真正执行器**。
2. `pinchtab` 已经提供成熟的 **HTTP API + CLI/插件封装 + skill 文档**，正好补这个缺口。
3. 用 HTTP 适配层接入，改动最小，最符合 `msgcode` 现有“Tool Bus 单一真相源”架构。

## 当前事实

### msgcode 现状

1. `src/tools/types.ts` 已声明 `browser` 工具。
2. `src/tools/bus.ts` 已给 `browser` 预留 side effect，但 **没有 `case "browser"` 执行分支**，最终会落到 `unsupported tool in P0`。
3. `src/skills/registry.ts` 已注册 `browser-skill`，但 skill 运行入口当前仍是占位实现。
4. `docs/tasks/p5-7-r7-browser-domain.md` 原计划用 Playwright 落地 `browser open|click|type`。

### pinchtab 现状

1. `README.md` 明确它是给 AI agent 用的 **浏览器控制 HTTP server**。
2. `docs/architecture/pinchtab-architecture.md` 说明主接口是 **HTTP + a11y tree**，不是重前端 SDK。
3. `plugins/pinchtab/cli.py` 已经把常见能力封成稳定命令：`navigate`、`snapshot`、`action`、`text`、`screenshot`、`pdf` 等。
4. `plugin/openclaw.plugin.json` 和 `skill/pinchtab/SKILL.md` 说明它已经按“agent tool”思路包装过一层。

## 推荐方案

### 方案 A：HTTP 后端接入 `msgcode browser`（推荐）

做法：

1. 在 `msgcode` 增加一个 `browser` 执行器，内部直接调用 PinchTab HTTP API。
2. 暴露最小命令面：
   - `browser navigate`
   - `browser snapshot`
   - `browser action`
   - `browser text`
   - 可选再加 `browser screenshot`
3. 由 `executeTool("browser")` 统一走 tool policy、日志、超时、artifact 记录。
4. 把 PinchTab 当作外部浏览器 substrate，`msgcode` 只做能力编排，不接管浏览器底层状态机。

为什么推荐：

1. 最贴合 `msgcode` 现有分层。
2. `pinchtab` 本身就主打 HTTP API。
3. 后续既能给 slash command 用，也能给 agent tool loop 用。

### 方案 B：走 MCP/插件直连（次选）

做法：

1. 复用 `plugins/pinchtab/cli.py` 这套 MCP/SMCP 风格封装。
2. 让模型通过插件直接调用 PinchTab，而不是先过 `msgcode` 的 browser tool。

问题：

1. `msgcode` 当前对 MCP 的接入很薄，`src/agent-backend/chat.ts` 里现在只看到固定 `mcp/filesystem` 注入。
2. 这条路会绕开现有 tool bus / tool policy / telemetry，容易形成第二套执行通道。

适用场景：

1. 你明确要把 `msgcode` 演进成“通用插件代理网关”。
2. 你愿意顺手重构 native MCP 插件注入机制。

### 方案 C：直接吃 npm SDK（不推荐）

不推荐原因：

1. `npm/src/index.ts` 和 `npm/README.md` 仍是较旧接口形态。
2. 当前主文档 `docs/references/endpoints.md` 已转向 instance/tab scoped 新 API。
3. 直接绑定 npm SDK，后面容易踩协议漂移。

结论：**优先直接对接 HTTP API，不要把 npm SDK 当集成基座。**

## 分阶段落地

### Phase 1：补齐 `msgcode browser` 最小闭环

目标：

1. 先让 `browser` 工具真正可执行。
2. 跑通 agent 最核心浏览器循环：`navigate -> snapshot -> action -> text`。

建议改动：

1. 新增 `src/runners/browser-pinchtab.ts`
2. 在 `src/tools/bus.ts` 增加 `case "browser"`
3. 新增 `src/cli/browser.ts`
4. `/help` 与 `help-docs --json` 暴露 browser 合同
5. 更新 `docs/tasks/p5-7-r7-browser-domain.md`，把 Playwright 改成 PinchTab 后端

### Phase 2：补运行时与安全约束

目标：

1. 让它能稳定长期跑。
2. 不把用户日常浏览器资料暴露给 agent。

建议补：

1. `PINCHTAB_BASE_URL`
2. `PINCHTAB_TOKEN`
3. `PINCHTAB_PROFILE`
4. `PINCHTAB_INSTANCE_ID` 或按 workspace/chat 生成映射
5. 默认要求专用 profile，禁止直接复用用户主 Chrome profile

### Phase 3：补提示与 skill

目标：

1. 让模型学会用对。
2. 控制 token 成本。

建议写进 system/skill 规则：

1. 读页面优先 `text`
2. 定位交互优先 `snapshot(filter=interactive, format=compact)`
3. 页面变化后再 snapshot，不要每步都全量抓
4. 需要视觉核验时才用 screenshot

## 关键设计决策

### 1. 单工具还是多工具

建议采用 **单 `browser` 工具 + `action` 参数分发**，不要拆成十几个工具名。

原因：

1. 更像 PinchTab 现成能力模型。
2. tool schema 更稳，prompt 更短。
3. 减少模型选错工具名的概率。

### 2. 单实例还是多实例

建议先做 **单 workspace 单 instance**。

不要一开始就做：

1. 多 chat 共享多 tab 自动调度
2. profile 自动猜测
3. 无感恢复复杂状态机

先把状态空间收紧，再逐步扩。

### 3. PinchTab 由谁启动

建议第一版 **外部常驻 + msgcode 连接**，不要让 msgcode 在首版里负责完整生命周期托管。

原因：

1. 先把协议接通，比进程托管更重要。
2. PinchTab 本身就是独立服务，天然适合解耦部署。
3. 少一层“进程启动失败 / 端口占用 / Chrome 探测”故障面。

## 先别踩的坑

1. 不要首版就把 OpenClaw 的 plugin 机制整套搬进 `msgcode`。
2. 不要首版就做多实例自动编排。
3. 不要把用户默认 Chrome profile 直接给 agent 用。
4. 不要同时维护 Playwright 和 PinchTab 两套 browser 后端。

## 建议的下一步

1. 直接把 `P5.7-R7` 任务单改成 “PinchTab 后端版 browser 域”。
2. 先做 Phase 1，目标只锁最小闭环。
3. 验证通过后，再决定是否值得补 MCP 直连能力。

## Evidence

- Docs: `README.md`（msgcode 双执行线与 Tool Bus 角色）
- Docs: `docs/tasks/p5-7-r7-browser-domain.md`（msgcode 原 browser 计划）
- Code: `src/tools/types.ts`
- Code: `src/tools/bus.ts`
- Code: `src/skills/registry.ts`
- Docs: `/Users/admin/GitProjects/GithubDown/pinchtab/README.md`
- Docs: `/Users/admin/GitProjects/GithubDown/pinchtab/docs/architecture/pinchtab-architecture.md`
- Code: `/Users/admin/GitProjects/GithubDown/pinchtab/plugins/pinchtab/cli.py`
- Code: `/Users/admin/GitProjects/GithubDown/pinchtab/plugin/openclaw.plugin.json`
- Docs: `/Users/admin/GitProjects/GithubDown/pinchtab/docs/references/endpoints.md`
- Code: `/Users/admin/GitProjects/GithubDown/pinchtab/npm/src/index.ts`
