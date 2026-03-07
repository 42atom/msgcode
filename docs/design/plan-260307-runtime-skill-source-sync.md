# Plan: Runtime skill 仓库源与安装目录单一真相源

Issue: 0014

## Problem

`pinchtab-browser` 现在已经进入运行时技能目录，但它仍然依赖一次性手工落盘。仓库内没有对应的 runtime skill 真相源，`msgcode init` 还保留着一套指向旧 `builtin/` 结构的过时逻辑。这会让安装链和运行时目录漂移，未来一旦用户清理配置目录或换机器，PinchTab skill 就可能再次缺失。

## Occam Check

- 不加它，系统具体坏在哪？
  新环境里即使代码和 prompt 都要求 `~/.config/msgcode/skills/pinchtab-browser/`，安装目录也可能没有这个 skill，模型会读到不存在的入口路径。
- 用更少的层能不能解决？
  能。只增加一份仓库托管 runtime skill 源，再用一个同步函数接到现有 `init/start` 即可，不需要重做整套 skill 平台。
- 这个改动让主链数量变多了还是变少了？
  变少了。runtime skill 从“手工目录 + 仓库外补丁”收口成“仓库源 -> 用户目录”一条主链。

## Decision

采用“仓库托管 runtime skills + init/start 幂等同步”的最小方案：

1. 在 `src/skills/runtime/` 存放仓库托管的 runtime skill 真相源。
2. 新增 `runtime-sync.ts`，只负责：
   - 从仓库源复制 skill 文件到 `~/.config/msgcode/skills/`
   - 合并 `index.json`
   - 保留用户已有自定义 skill
3. `msgcode init` 显式执行同步；`msgcode start` best-effort 执行同步，防止缺 skill 启动后才暴露。
4. 暂只托管 `pinchtab-browser`，不在本轮迁移所有历史 skills。

## Alternatives

### 方案 A：继续手工维护 `~/.config/msgcode/skills/pinchtab-browser`

- 优点：零代码改动。
- 缺点：不可复制、不可审查、换机就丢。

### 方案 B：把所有历史 skill 一次性迁进仓库

- 优点：最终更完整。
- 缺点：明显扩 scope，本轮只是修 `pinchtab-browser` 依赖丢失。

### 方案 C：只托管 `pinchtab-browser`，同步时保留用户自定义 skills（推荐）

- 优点：最小可删、直接解决缺依赖问题。
- 缺点：历史 skill 体系仍有旧债，但不影响本轮目标。

## Plan

1. 仓库托管 runtime source
- 新增文件：
  - `src/skills/runtime/index.json`
  - `src/skills/runtime/pinchtab-browser/SKILL.md`
  - `src/skills/runtime/pinchtab-browser/main.sh`
- 验收点：
  - 仓库中存在可安装的 `pinchtab-browser` 真相源

2. 同步模块
- 新增文件：
  - `src/skills/runtime-sync.ts`
- 改动：
  - 递归复制托管 skill 文件
  - 复制后继承源文件 mode
  - 合并 `index.json`，保留用户已有非托管 skills
- 验收点：
  - 同步不覆盖自定义 skill 索引

3. 接入 init/start
- 修改文件：
  - `src/cli.ts`
  - `src/commands.ts`
- 改动：
  - `msgcode init` 显式同步 runtime skills
  - `startBot()` best-effort 同步 runtime skills
- 验收点：
  - 新安装和已有安装都能自动补齐 `pinchtab-browser`

4. 文档与回归
- 修改文件：
  - `src/skills/README.md`
  - `docs/CHANGELOG.md`
  - `test/p5-7-r13-runtime-skill-sync.test.ts`
- 验收点：
  - 文档口径与代码一致
  - 测试覆盖同步和索引合并

## Risks

1. 如果同步逻辑粗暴覆盖 `index.json`，会丢失用户自定义 skills。
回滚/降级：只合并托管 skill 项，不删除其他项。

2. 如果只在 `init` 同步，已有安装用户依然可能缺 skill。
回滚/降级：在 `startBot()` 增加 best-effort 同步，失败仅打日志，不阻断主链。

3. 如果仓库源 `main.sh` 没有可执行位，安装后运行会失败。
回滚/降级：同步时显式复制源文件 mode，并在测试中锁住执行位。

## Test Plan

- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r13-runtime-skill-sync.test.ts`
- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r13-pinchtab-bootstrap.test.ts`
- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r9-t2-skill-global-single-source.test.ts`

## Observability

- `startBot()` 同步成功时记录：
  - `copiedFiles`
  - `skippedFiles`
  - `managedSkillIds`
- 同步失败时显式 warn，不静默吞掉。

（章节级）评审意见：[留空,用户将给出反馈]
