# Skill 系统分层与冲突策略研究

## 问题

`msgcode` 现在已经不是“没有 skill 系统”，而是进入了第二阶段：

- 有 `runtime` 常驻层
- 有 `optional` 按需层
- 有 `runtime-sync` 与运行时目录

真正的问题变成：

- 以后 skill 越来越多时，如何继续保持薄 core
- 如何区分“系统自带但可选”和“用户后装”
- 如何允许 workspace 覆盖，但不污染 core
- 如何处理同名 skill 冲突与来源不明

## 当前 msgcode 设计

### 已有优点

1. 已经把 skill 从 core 逻辑中拆出来
2. 已经区分了 `runtime` 与 `optional`
3. 提示词已经收敛为：
   - 先读主索引
   - 主索引无覆盖时再按需看 optional 索引
4. 当前 skill 更像说明书，而不是流程编排器

### 当前缺口

1. 来源边界不清
- `~/.config/msgcode/skills/` 同时承载 repo 同步产物与用户目录
- 当前 `runtime-sync.ts` 会把 repo skill 合并进用户 index
- 结果是“bundled skill”和“user managed skill”没有清晰分层

2. 缺正式的 user-managed 层
- 目前只有 repo 自带 runtime/optional
- 还没有正式口径去表达“这是用户自己安装的 skill”

3. workspace 层还没进入正式主链
- `src/skills/README.md` 提到了 `<workspace>/.msgcode/skills/`
- 但当前只是待实现口径，不是正式有效层

4. 缺 conflict policy
- 当前没有明确说同名 skill 到底谁赢
- 也没有 core skill 是否允许被覆盖的规则

5. 缺 per-skill enable/gating
- 当前只有“大体上是否存在这个 skill”
- 还没有正式的 enabled / disabled / requires 语义

## OpenClaw 的处理方式

参考：
- `/Users/admin/GitProjects/GithubDown/openclaw/docs/tools/skills.md`
- `/Users/admin/GitProjects/GithubDown/openclaw/docs/tools/skills-config.md`
- `/Users/admin/GitProjects/GithubDown/openclaw/docs/cli/plugins.md`

### 值得学的点

1. 清晰来源分层
- bundled skills
- `~/.openclaw/skills` managed/local
- `<workspace>/skills` workspace
- 还有 `extraDirs`

2. precedence 很明确
- workspace > managed/local > bundled

3. skill 与 plugin 分开
- plugins 是代码模块
- skills 是说明书目录
- plugin 可以附带 skills，但两者不是同一层

4. 有 per-skill config/gating
- `enabled`
- `requires.env`
- `requires.bins`
- `requires.config`

### 不适合直接照搬的点

1. 它已经有比较重的插件/registry/config 体系
2. 有 ClawHub、install/update/uninstall 等完整分发逻辑
3. 对 `msgcode` 现在来说，整套 marketplace/registry 太重

## Goose 的处理方式

参考：
- [Using Extensions](https://block.github.io/goose/docs/getting-started/using-extensions/)
- [Recipe Reference Guide](https://block.github.io/goose/docs/guides/recipes/recipe-reference/)

### 值得学的点

1. 区分 platform extensions 与普通 extensions
- platform extensions 是全局基础能力
- 其他 extensions 可开可关

2. 支持 session 级启停
- 一个能力可以默认关闭，只在当前 session 打开

3. recipes 把“说明书 + 扩展组合”打包
- 这说明 extension/skill 的组织，不一定都要落到 core

### 不适合直接照搬的点

1. Goose 的核心是 MCP extension 平台，不是文件优先 skill 系统
2. 它强调的是“工具连接面”，而不是像我们这样把 skill 当成本地说明书真相源

## 对 msgcode 的判断

### 结论 1：我们现在缺的不是更多 skill，而是“更清晰的来源层级”

真正要补的是：

- 这个 skill 从哪里来
- 默认是否携带
- 是否可关闭
- 是否允许覆盖别人

### 结论 2：skill 与 plugin/arm 必须继续分开

不能把这些混成一个总平台：

- skill：说明书 / 行为协议
- plugin / arm：桌面执行、浏览器执行、外部引擎等能力实现

例如：

- `ghost-os` 应该是 desktop plugin
- `character-identity` 应该是 skill

### 结论 3：最薄的分层应是四层

1. bundled core
- repo 自带
- 默认携带
- 保留区
- 不允许普通覆盖

2. bundled optional
- repo 自带
- 默认不同步进主索引或不同步进常驻上下文
- 按需发现、按需加载

3. user managed
- 用户安装的全局 skill
- 属于当前机器，不属于 repo

4. workspace local
- 当前 workspace 自己的 skill
- 用于项目/团队局部规则

## 推荐的 msgcode 分层模型

### 目录层

保持现有结构不大改，只补最小缺口：

- `src/skills/runtime/`
  - 视为 bundled core
- `src/skills/optional/`
  - 视为 bundled optional
- `~/.config/msgcode/skills/managed/`
  - 新增 user managed
- `<workspace>/.msgcode/skills/`
  - 正式启用 workspace local

### 运行时层

运行时不要再把所有来源糊成一个不透明用户目录，而应该生成一个“生效索引”：

- `~/.config/msgcode/skills/effective-index.json`

这个文件只回答一件事：
- 当前实际可见的 skill 是谁
- 它来自哪一层
- 是否 enabled

### 角色层

四层建议命名为：

- `core`
- `system-optional`
- `managed`
- `workspace`

## 推荐 conflict policy

### 一、同名 skill 冲突

#### 规则

1. `workspace` > `managed` > `system-optional`
2. `core` 为保留区，默认不允许被覆盖

#### 原因

- workspace 覆盖是局部最强语义
- user managed 应该能覆盖系统 optional
- core 是大脑的一部分，不该被任意影子覆盖

### 二、core 保留区

以下类型的 skill 应进入保留区：

- `plan-files`
- `character-identity`
- `scheduler`
- `patchright-browser`
- `vision-index`

这些不是因为“最重要”，而是因为它们已经参与主链语义。

### 三、alias/command 冲突

如果未来 skill 带 alias 或 slash command：

- 同名 alias 冲突默认 fail-closed
- 不自动猜测谁赢
- 必须在 effective index 生成时记录冲突并禁用冲突 alias

### 四、未满足依赖的 skill

skill 若声明：

- 缺 env
- 缺 bin
- 缺 config

则不要对 LLM 隐形撒谎。

最薄做法：
- 不把它算作 enabled
- 在 effective index 里保留 `disabledReason`

## 推荐 enable 模型

每个 skill 至少支持这几个字段：

- `id`
- `layer`
- `enabled`
- `entry`
- `description`
- `source`
- `disabledReason`

其中：

- `enabled = true`
  - 可以进入可发现索引
- `enabled = false`
  - 不应默认暴露给模型

## 推荐的实现顺序

### 第一步
只补“来源层级 + effective index + precedence”

先不做安装器，不做 marketplace。

### 第二步
再正式引入 `managed` 层与 workspace skill 层。

### 第三步
最后再补 per-skill gating：

- env/bin/config
- enabled/disabled
- disabledReason

## 对当前设计的直接建议

### 保留

- `runtime` / `optional` 二分法
- 提示词“先主索引，再 optional”
- skill 作为说明书，而不是编排器

### 收口

1. 不再让 `~/.config/msgcode/skills/index.json` 同时充当所有来源的模糊总表
2. 明确加 `managed` 层
3. 正式实现 workspace 层
4. 生成 `effective-index.json`
5. 定死 core 保留区与 precedence

## 最小推荐方案

一句话：

`msgcode` 不需要 OpenClaw 那么重的 skill 平台，但必须补上 OpenClaw 那种“来源层级 + precedence + gating”最小骨架。

最小可删版本就是：

1. 维持现有 `runtime/optional`
2. 新增 `managed` 与 `workspace`
3. 新增 `effective-index.json`
4. 定死：
   - `workspace > managed > system-optional`
   - `core` 不可覆盖

这就够了。
