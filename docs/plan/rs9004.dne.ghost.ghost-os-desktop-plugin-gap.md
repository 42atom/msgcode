# ghost-os 与 msgcode 自研 mac 部分的分层差距研究

## 背景

用户提出一个明确判断：

- `mac` 部分也应该视为插件能力，而不是 core
- 所有“手臂”能力都必须可关闭
- 插件不得反向污染 `msgcode` 的 `run / session / task / context` 主链

同时，用户在本地引入了 `ghost-os` 源码，希望判断它是否已经比当前 `msgcode/mac` 更成熟，是否值得替换当前自研桌面执行层。

## 研究对象

### ghost-os

- 仓库：`/Users/admin/GitProjects/GithubDown/ghost-os`
- 关键入口：
  - `README.md`
  - `Sources/ghost/main.swift`
  - `Sources/ghost/Doctor.swift`
  - `Sources/ghost/SetupWizard.swift`
  - `Sources/GhostOS/MCP/`
  - `Sources/GhostOS/Perception/`
  - `Sources/GhostOS/Actions/`
  - `Sources/GhostOS/Recipes/`
  - `Sources/GhostOS/Vision/`

### msgcode/mac

- 目录：`/Users/admin/GitProjects/msgcode/mac`
- 关键入口：
  - `mac/README.md`
  - `mac/MsgcodeDesktopHost/README.md`
  - `mac/MsgcodeDesktopHost/BridgeServer.swift`
  - `mac/msgcode-desktopctl/Sources/msgcode-desktopctl/main.swift`

## 核心观察

## 1. ghost-os 不是“Mac 壳”，而是完整的桌面 computer-use substrate

从 `ghost-os` README 和源码结构看，它已经具备完整的桌面执行底座形态：

- `setup / doctor / status` CLI
- MCP server 入口
- AX tree 感知
- 本地视觉 fallback
- click/type/scroll/window 等动作层
- recipe/workflow 存储与运行

它的定位是：

**Full computer-use for AI agents**

这说明它的真实层级更接近：

- desktop automation runtime
- computer-use plugin substrate
- MCP-compatible desktop execution engine

而不是一个简单的原生 UI。

## 2. msgcode 当前的 mac 部分更像“权限宿主 + bridge + 外壳”

从 `mac/README.md` 看，当前 `msgcode/mac` 主要承担：

- menubar host
- 权限宿主
- XPC bridge
- `desktop.health / desktop.doctor / desktop.observe`

它当前最像的是：

- desktop host shell
- permission carrier
- execution bridge

而不是完整的桌面执行引擎。

## 3. 两者不在同一成熟度层级

`ghost-os` 已经把下面这些重活做成了正式产品面：

- setup
- doctor
- action surface
- perception
- recipes
- local vision
- MCP contract

而当前 `msgcode/mac` 的职责更窄、更薄，也更像一个早期自研 bridge。

因此，这里真正成立的判断不是：

- `ghost-os` 是否比我们的“界面”更成熟

而是：

- `ghost-os` 是否比我们的“桌面执行插件实现”更成熟

答案是：

**是。**

## 正确的分层判断

这次对比后，应冻结如下三层：

### 1. Core（大脑）

仍然归 `msgcode` 所有：

- run
- session
- task
- context policy
- memory
- artifacts
- schedule
- channel routing
- human handoff

### 2. Plugin（手臂）

桌面 computer-use 应归类为插件能力，不应进入 core。

这层可以由不同实现提供：

- 当前自研 `mac` bridge
- `ghost-os`
- 未来其他 desktop substrate

这层必须满足：

- 可关闭
- 可替换
- 不向 core 泄漏实现细节

### 3. Shell / Surface（外壳）

当前 `msgcode/mac` 中仍可能有保留价值的部分：

- menubar host
- 本机入口
- 权限壳
- 未来桌面 surface

但这些不应继续承担桌面执行引擎的主责任。

## 结论

**应该替换的是“自研桌面执行层”，不是 `msgcode core`。**

更准确地说：

- `ghost-os` 适合成为 `msgcode` 的桌面执行插件实现
- `msgcode` 自己不应继续把 desktop computer-use 做进 core
- 当前 `mac` 目录若保留，应更偏 shell / host，而不是继续长成完整桌面 automation runtime

## 为什么这符合薄 core 原则

如果继续自研桌面执行层，core 会被迫吸收越来越多本不该属于自己的东西：

- AX
- 截图
- 点击/输入/窗口控制
- 权限诊断
- 本地视觉 fallback
- workflow/recipe

这会直接违反当前已经冻结的原则：

- 插件可关闭
- 手臂不可污染大脑
- core 只保留统一 runtime substrate

## 推荐方向

### 推荐结论

**冻结当前自研桌面执行层的继续扩张。**

**以 `ghost-os` 作为未来桌面插件的首个正式实现。**

### 但不建议立刻删除的部分

当前 `mac/` 中以下能力可以先保留：

- 权限承载
- 菜单栏入口
- 本机启动/托管体验
- 未来 surface 外壳

也就是：

**保留 shell，替换 arm。**

## 非目标

- 本文不做 `ghost-os` 接入实现
- 本文不定义最终插件协议代码
- 本文不改变当前 Agent Core Phase 排期
- 本文不要求立刻删除 `mac/` 目录

## 后续约束

如果后续实施 `ghost-os` 替换方案，必须满足：

1. `ghost-os` 可整体关闭，不影响 `msgcode core`
2. core 不依赖 `ghost-os` 的内部对象模型
3. desktop plugin 只能通过薄 contract 与 core 交互
4. 不允许把 `ghost-os` 的 setup/doctor/recipe 语义直接焊进 `run/session/task/context`

