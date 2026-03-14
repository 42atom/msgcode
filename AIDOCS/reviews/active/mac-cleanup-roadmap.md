# `mac/` 目录清理与退役路线图 (The Great Purge)

在确认 `ghost-os` 将作为唯一现役桌面插件后，`msgcode` 仓库根目录下的 `mac/` 文件夹（包含了 `MsgcodeDesktopHost` 和 `msgcode-desktopctl`）已经从“核心引擎”瞬间变成了**“沉重的历史遗产”**。

这 7000 多行 Swift 代码涉及极其复杂的 XPC 通信、权限劫持、坐标转换和图像处理。现在是时候把它们扫进历史的垃圾堆了，让仓库重新净身出户。

根据我们“做薄”的原则，清理不能粗暴地一刀切（防止用户无 ghost-os 可用），必须遵循**“先降级、后斩首”**的剥离策略。以下是清理路线图：

---

## 🔪 第一刀：架构降级与隔离（当前即可执行）

**目标：斩断核心对 `mac/` 的心智依赖，把它变成一个随时可丢弃的备胎。**

1.  **打上墓碑标记 (Deprecation Notice):**
    在 [mac/README.md](file:///Users/admin/GitProjects/msgcode/mac/README.md) 的最顶部加上显眼的 `[DEPRECATED]` 警告，明确说明此目录即将随 `ghost-os` 的全面切流而删除，停止一切新功能开发（哪怕是修复 P2 级别的 Bug）。
2.  **清理外围安装脚本:**
    目前仓库的根目录 [package.json](file:///Users/admin/GitProjects/msgcode/package.json) 或 `scripts` 中，必然有 `build:mac` 或类似的钩子。将这些编译脚本从默认的 `npm install` 或 `npm run build` 生命周期中摘除。只保留手动执行的入口，不再强迫所有协作者每次都编译一遍这堆即将废弃的 Swift 代码。
3.  **封死能力边界:**
    严格禁止任何人再在此目录下新增任何方法（严禁在 XPC 里加什么 `desktop.drag`）。即使真有需求，也全部引流去 `ghost-os` 的能力面。

## 🔪 第二刀：灰度期与代码冷冻（随着 ghost-os 上线）

**目标：在 `ghost_click` 等原生工具通过大模型实战验证、且局部 Confirm Gate 稳定运行时执行。**

1.  **切断 Tool Bus 的默认流量:**
    随着 `ghost-mcp-client.ts` 上位，原有的 `src/runners/desktop.ts` （负责单次 spawn `msgcode-desktopctl` 的那个几十行 wrapper）保留，但将 `desktop.provider` 的默认值拨给 `ghost`。
2.  **清理相关的“影子代码”:**
    *   删除原有为了给 `MsgcodeDesktopHost` 发指令而在 TS 里写的各种啰嗦的参数组装器。
    *   删除那些专门锁定旧 `desktop.click` 行为的**遗产集成测试（Legacy Tests）**。不用可惜，保护旧 API 行为的测试一旦过时就是在阻碍系统演进。

## 🔪 第三刀：物理抹除（The Final Purge）

**目标：当 `ghost-os` 成为事实上的唯一桌面标准，彻底拔除旧底座。**

1.  **物理删除 `mac/` 目录:**
    执行 `rm -rf mac/`。一次性干掉那将近 7,000 行的 Swift 代码和 XPC 配置。
2.  **删除 `src/runners/desktop.ts`:**
    连那个几十行的 legacy provider wrapper 全部删掉，只保留 `ghost-mcp-client.ts`。
3.  **彻底退役 LaunchAgent:**
    在文档里补一句卸载旧版守护进程 `com.msgcode.desktop.bridge` 的命令（`launchctl unload ...`）。让用户环境也得到净化。
4.  **改写权限说明（TCC）：**
    官网或 README 里的“申请辅助功能与截屏权限”主体，从 `MsgcodeDesktopHost` 改为 `ghost` 终端指令或 Mac App。

---

**总结架构收益：**
拔除 `mac/` 之后，`msgcode` 将重新回到最高贵的形态——**一个纯粹用 TypeScript 写成的超轻量级核心（Thin-Core）。** 它自己不再背负任何一团 OS 级别的黑盒二进制包，所有的操作系统交互全部通过透明的通道（Bash Shell, Patchright CDP, Ghost MCP）扔给外部第一公民执行。这是一次伟大的重构胜利！
