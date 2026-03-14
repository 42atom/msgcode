# ghost-os 接入 msgcode 方案

## 结论

推荐方案：

**保留 `msgcode core`，不把 `ghost-os` 嵌进 core。**

**Agent 最终直接使用 `ghost_*` 原生工具；`msgcode` 只负责薄挂载，不长期保留 `desktop.*` 假面具。**

**迁移顺序是：先说明书与安装、再挂载、再灰度、最后退役 legacy `msgcode-desktopctl`。**

这条路最符合当前仓库已经冻结的 Unix 哲学：

- 不新增平台层
- 不重写 agent 主链
- 不把 `ghost-os` 对象模型泄漏进 `run/session/task/context`
- 保持“模型 -> `ghost_*` 工具 -> provider -> 结果 -> 模型”的单一主链

---

## 1. 现状与问题

当前 desktop 链路已经被连续收薄，但本质还是旧桥：

1. `src/tools/bus.ts`
   - 调 `desktop` 工具
2. `src/runners/desktop.ts`
   - 单次 spawn `msgcode-desktopctl rpc`
3. `mac/msgcode-desktopctl`
   - CLI bridge
4. `mac/MsgcodeDesktopHost`
   - XPC host，真正持有 TCC 权限

这条链已经比之前薄了很多，但仍有两个根问题：

1. `msgcode` 仍然在维护一套自研 desktop substrate
2. 后续若继续做 perception/action/recipe/vision，厚度会重新回流到仓库里

而 `ghost-os` 的实际定位已经不是“某个小工具”，而是完整的 desktop computer-use substrate。

---

## 2. ghost-os 的真实形态

从本地源码看，`ghost-os` 是：

- 一个 Swift 可执行程序 `ghost`
- 一个 MCP server：`ghost mcp`
- 自带 `setup / doctor / status`
- 自带 perception / actions / recipes / vision

它不是适合被我们“import 进来”的内部库，更适合作为**外部 provider / substrate**。

### 安装形态

两种主路径：

1. Homebrew
```bash
brew install ghostwright/ghost-os/ghost-os
ghost setup
```

2. 源码安装
```bash
git clone https://github.com/ghostwright/ghost-os.git
cd ghost-os
swift build
.build/debug/ghost setup
```

### 运行形态

核心命令只有几类：

- `ghost mcp`
- `ghost setup`
- `ghost doctor`
- `ghost status`
- `ghost version`

也就是说，它天然适合以**外部进程 + stdio MCP**形态接入，而不是被我们塞进现有 `mac/` 里做内嵌桥。

---

## 3. 与当前 msgcode 架构的契合度判断

## 高契合的部分

1. 都是“桌面能力应是手臂，不是大脑”
   - 这和当前 `docs/design/plan-260310-ghost-os-desktop-plugin-replacement.md` 完全一致

2. `ghost-os` 已自带 setup / doctor / status
   - 这意味着我们不必再在 `msgcode` 内部继续扩张 desktop 运维面

3. `ghost-os` 通过 MCP 暴露能力
   - 这和“作为外部 provider 接入”天然匹配

4. `ghost-os` 自带 recipes
   - 这说明 desktop workflow 学习与执行可以停留在 provider 层，不必回灌到 `msgcode core`

## 低契合/需要适配的部分

1. 确认模型不一致
   - msgcode 当前有 `desktop.confirm.issue` + token
   - `ghost-os` 侧更像直接动作工具，不一定原生遵守我们现有 confirm token 合同

2. 证据与 artifact 结构不一致
   - msgcode 现在锁定 `workspace/artifacts/desktop/...`
   - `ghost-os` 有自己的 recipes / vision / 诊断目录与输出形态

3. transport 不一致
   - 现有 legacy 是 “tool bus -> runner -> CLI rpc”
   - `ghost-os` 更适合 “tool bus -> runner -> MCP client call”

## 结论

**契合的是分层，不是旧接口。**

也就是说：

- 架构方向：高度契合
- 直接 drop-in 到旧 `desktop.*`：不合适
- 正确姿势：挂载 `ghost_*` 原生工具，并在本地 runner 只保留最薄通信与局部安全校验

---

## 4. 推荐接入方案

## 方案总览

### 方案 A：把 ghost-os 嵌进 `msgcode/mac`

不推荐。

原因：

- 违反“插件可关闭”
- 让 `msgcode` 再次吸收 provider 细节
- 会把 `ghost setup/doctor/vision/recipes` 这些 provider 语义反向焊进 core

### 方案 B：直接给 Agent 暴露 ghost MCP 全量工具

**推荐。**

原因：

- 真实能力面直接暴露
- 不新增长期翻译层
- 最符合 `ghost-os` 自身设计
- 最符合当前“不要再继承历史债务”的口径

### 方案 C：保留 `desktop` 工具合同，后端 provider 从 legacy desktopctl 切到 ghost-os adapter

只允许作为短期迁移脚手架，不推荐长期保留。

原因：

- 容易形成新的兼容债务
- 会掩盖真实能力面
- 后续每新增 `ghost` 能力都要重复映射一次

---

## 5. 从安装依赖到实现的落地步骤

## 阶段 0：冻结边界

先定死三条：

1. `ghost-os` 是 desktop provider，不是 core
2. 不新增 desktop manager / plugin platform / controller
3. `ghost_*` 是最终工具面，旧 `desktop` contract 不是长期目标

---

## 阶段 1：安装与环境探测

目标：让 msgcode 能检测 `ghost-os` 是否可用，但还不切流量。

### 最小实现

新增一个很薄的 provider 探测函数，例如：

- `findGhostBinary()`
- `checkGhostStatus()`

只做三件事：

1. 找 `ghost` 可执行文件
   - 优先环境变量，例如 `MSGCODE_GHOST_PATH`
   - 其次 `which ghost`
   - 再其次常见路径 `/opt/homebrew/bin/ghost`

2. 调 `ghost status`
   - 判定 binary 存在
   - 判定 Accessibility / Screen Recording 状态

3. 记录 provider 状态
   - `available`
   - `healthy`
   - `version`

### 不做的事

- 不在 `msgcode` 里重写 `ghost setup`
- 不在 `msgcode` 里复制 `doctor` 文案
- 不在 `msgcode` 里替用户写 MCP 配置

`ghost-os` 自己已经有 setup/doctor，应该直接复用。

### 安装策略决策

推荐默认策略：

1. README / 上手文档提示用户显式安装
   - `brew install ghostwright/ghost-os/ghost-os`
   - `ghost setup`
2. `msgcode` 在缺失依赖时给出真实错误与安装指引
3. 不在 `msgcode` 默认安装流程里静默代装第三方 binary

如果未来要做“一起安装”，也只能做成显式 opt-in helper，而不是默认行为。

---

## 阶段 2：定义最薄 provider seam

目标：只在 runner 层新增一个 provider 选择，不把 provider 语义泄漏到上层。

### 推荐形态

新增：

- `src/runners/ghost-mcp-client.ts`
- 最小 `ghost` binary 探测与 MCP 调用
- 必要时的 provider on/off 配置

### 注意

这不是新增平台层，只是最薄通信层。

如果需要并存 legacy，也只允许在 runner 级别做 provider 选择，不允许再上升成新的总线编排层。

---

## 阶段 3：暴露原生工具面

目标：让 Agent 直接拿到 `ghost_*` 原生工具。

### 推荐做法

- 直接把 `ghost mcp` 返回的工具面挂给 Agent
- 不长期保留 `desktop.find -> ghost_find` 这类映射
- 若为了切换需要短期兼容，也必须显式标记为迁移脚手架，并有 sunset 计划

---

## 阶段 4：实现 MCP 调用器

目标：从 `msgcode` 调用 `ghost mcp`。

这里有两个技术路径：

### 路径 A：做一个最小 MCP stdio client

推荐。

理由：

- `ghost-os` 本来就是 MCP server
- msgcode 只需最薄 JSON-RPC/MCP client
- 不需要重写 provider 的业务逻辑

最小职责只有：

1. 启动 `ghost mcp`
2. 初始化 MCP session
3. 列出工具
4. 调用目标工具
5. 解析结构化结果

### 路径 B：shell out 到 `claude mcp` 之类外部命令

不推荐。

理由：

- 会多包一层别人的 CLI
- 增加不稳定依赖
- 背离“直接连真实能力”的原则

### 落地建议

新增一个最小文件，例如：

- `src/runners/ghost-mcp-client.ts`

只做 stdio MCP client，不做业务编排。

---

## 阶段 5：局部 confirm token

目标：避免把个别高危动作升级成全局审批系统。

推荐做法：

1. 如果 `ghost_click / ghost_type / ghost_drag / ghost_hotkey` 等动作仍需 token
2. token 校验只留在 `ghost-mcp-client`
3. Tool Bus 不新增全局审批层

这是一处明确的局部妥协，但它比“为桌面动作发明全局中继拦截层”更符合奥卡姆剃刀。

---

## 阶段 6：证据与 artifact 对齐

目标：不要求 `ghost-os` 改成 msgcode 的内部格式，但要保证上层仍有可导航事实。

保留上层当前已经锁住的字段语义：

- `stdout`
- `stderr`
- `artifacts`
- `fullOutputPath`
- desktop evidence path

推荐做法：

1. 若 `ghost-os` 原生返回截图/上下文/recipe 结果路径
   - adapter 直接转成 `artifacts`

2. 若 `ghost-os` 不落到 workspace 内
   - adapter 在 `workspace/artifacts/desktop/...` 下写一份最小 result snapshot
   - 内容只包含 provider 原始响应与外部引用路径

重点是：

**不要要求 ghost-os 先改成我们的内部目录结构。**

adapter 自己负责把“导航事实”补齐即可。

---

## 阶段 7：skill 与 README

目标：既暴露真实能力，也给模型和用户一份正确说明书。

### skill 策略

`ghost-os` 仓库已经提供一份高质量说明书：

- `ghost-os/GHOST-MCP.md`

msgcode 侧仍应补一份本地 skill，但只做本地化：

1. 何时优先 `ghost_recipes`
2. 何时先 `ghost_context`
3. Web 场景优先 `dom_id`
4. 失败时先 `ghost_annotate / ghost_screenshot / ghost_ground`
5. msgcode 本地的安装、探测、日志、局部 token 口径

### README 策略

README / 上手文档必须补：

1. 安装命令
2. `ghost setup`
3. `ghost doctor`
4. msgcode 如何探测到 ghost 缺失并给出安装提示

不建议默认在 `msgcode init/install` 里静默代装 `ghost`。

---

## 6. 与当前桥接系统的契合关系评估

## 契合点

1. `src/runners/desktop.ts` 已经被我们收成“一次请求 -> 一次外部命令”
   - 这正好适合被新的 `ghost-mcp-client` 替换

2. `/desktop` slash 已收成 `rpc` 单入口
   - route 层已经不再妨碍 provider 替换

3. `desktop` 已退出默认 LLM 工具暴露链
   - 替换期风险更低

4. 当前 `Tool Bus` 已不再背太多 desktop 解释层
   - 接 provider 会更干净

## 不契合点

1. 当前 contract 有 confirm token
   - `ghost-os` 未必原生具备同一确认模型
   - 需要 msgcode 在 `ghost-mcp-client` 本地保留 token gate

2. 当前 tests 锁的是 legacy desktop 行为
   - 替换时需要新增 `ghost_*` 集成测试，并删掉旧 `desktop` 遗产锁

## 最终判断

**架构上契合，旧接口上不兼容，迁移上可控。**

换句话说：

- 值得接
- 不能继续长期保旧假接口
- 应该通过薄挂载 + 原生工具直出接

---

## 7. 推荐实施顺序

### Phase 1：文档与安装

1. 补 README / 上手文档
2. 衍生 msgcode 本地 ghost skill
3. 新增 `ghost` binary/status/doctor 探测

### Phase 2：挂载 ghost MCP

1. 新增 `ghost-mcp-client`
2. 直接暴露 `ghost_*`
3. 局部 token gate 只放在 client 内

### Phase 3：灰度切换

1. 开发机/workspace opt-in `ghost`
2. 跑 `ghost_*` 集成回归
3. 对比 legacy vs ghost 成功率与证据输出

### Phase 4：切默认 / legacy 下沉

当且仅当：

1. `ghost_*` 稳定
2. 局部 token 语义不回归
3. artifact 导航事实稳定

才把默认桌面能力切成 `ghost`，并让 `desktop` 旧链路继续下沉直至归档。

---

## 8. 明确不建议做的事

1. 不建议把 `ghost-os` 当新 core
2. 不建议把 `ghost setup/doctor` 重写进 `msgcode`
3. 不建议为兼容旧 contract 长期保留翻译层
4. 不建议先做 plugin platform / desktop manager
5. 不建议把局部 confirm 问题升级成全局审批层

---

## 9. 一句话决策

**最优路径不是“把 ghost-os 并入 msgcode”，也不是“继续给它套一层 desktop 假面具”，而是“让 ghost-os 原生工具成为新手臂，msgcode 继续只做薄脑、薄挂载和局部边界”。**

---

## 证据

- Docs:
  - `docs/design/plan-260310-ghost-os-desktop-plugin-replacement.md`
  - `docs/notes/research-260310-ghost-os-desktop-plugin-gap.md`
  - `docs/desktop/contract.md`
  - `/Users/admin/GitProjects/GithubDown/ghost-os/README.md`
- Code:
  - `src/runners/desktop.ts`
  - `src/tools/manifest.ts`
  - `/Users/admin/GitProjects/GithubDown/ghost-os/Sources/ghost/main.swift`
  - `/Users/admin/GitProjects/GithubDown/ghost-os/Sources/ghost/Doctor.swift`
  - `/Users/admin/GitProjects/GithubDown/ghost-os/Sources/ghost/SetupWizard.swift`
