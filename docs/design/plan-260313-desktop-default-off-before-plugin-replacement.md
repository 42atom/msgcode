# plan-260313-desktop-default-off-before-plugin-replacement

## Problem

内建 `desktop` 仍在默认 `tooling.allow` 与 LLM 工具暴露链路里，导致自研 desktop bridge 在开源替换前继续常驻模型主链。这样会把 `msgcode-desktopctl` / XPC / Host 这套重桥接能力继续当成常规工具，而不是显式 opt-in 的遗留能力。

## Occam Check

### 不加它，系统具体坏在哪？

- 默认 workspace 会继续把内建 `desktop` 暴露给模型
- 后续切换开源实现时，会同时牵动默认配置、manifest 暴露和执行臂替换
- 自研 desktop bridge 继续占据主链资格，偏离“薄 core + 插件能力”方向

### 用更少的层能不能解决？

- 能。先把内建 `desktop` 从默认和 LLM 暴露主链里退下去，不新增 provider/controller

### 这个改动让主链数量变多了还是变少了？

- 变少了。默认主链少一个重桥接能力；`desktop` 退回显式链路

## Decision

选定方案：将内建 `desktop` 调整为“遗留显式工具”。

- 默认 `tooling.allow` 去掉 `desktop`
- LLM 默认 suppress 列表加入 `desktop`
- `/tool allow` 文案改为区分常规工具与遗留显式工具

这样不删执行臂，只先删主链资格，为后续开源 desktop 实现替换留干净边界。

## Plan

1. 修改 `/Users/admin/GitProjects/msgcode/src/config/workspace.ts`
   - 默认 `tooling.allow` 去掉 `desktop`
2. 修改 `/Users/admin/GitProjects/msgcode/src/tools/manifest.ts`
   - `LLM_DEFAULT_SUPPRESSED_TOOLS` 加入 `desktop`
3. 修改 `/Users/admin/GitProjects/msgcode/src/routes/cmd-tooling.ts`
   - `desktop` 从常规可见工具列表移出
   - 保留为遗留显式工具可配置项
4. 更新测试
   - `/Users/admin/GitProjects/msgcode/test/p5-6-8-r4g-pi-core-tools.test.ts`
   - `/Users/admin/GitProjects/msgcode/test/p5-7-r8c-llm-tool-manifest-single-source.test.ts`
   - 如有需要补最小 route/tooling 文案锁
5. 更新 `/Users/admin/GitProjects/msgcode/docs/CHANGELOG.md`
6. 运行验证并提交

## Risks

1. 旧 workspace 若依赖 LLM 自动调用 `desktop`，行为会变成不再自动暴露
   - 回滚：恢复默认 allow 与 suppress 前状态
2. `/tool allow` 文案若改得太激进，可能误伤用户的显式 slash 使用认知
   - 回滚：保留 `desktop` 作为可配置遗留工具，并明确只是不进 LLM 主链

## Test Plan

- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-6-8-r4g-pi-core-tools.test.ts test/p5-7-r8c-llm-tool-manifest-single-source.test.ts test/tools.bus.test.ts test/routes.commands.test.ts`
- `npx tsc --noEmit`
- `npm run docs:check`

（章节级）评审意见：[留空,用户将给出反馈]
