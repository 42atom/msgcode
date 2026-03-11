# 下线脆弱的 zai-vision-mcp runtime skill

## Problem

`zai-vision-mcp` 目前仍在正式 runtime skill 索引中，对模型来说属于可见、可选、可推理到的正式能力。但用户已经明确判断这条能力“太脆弱”，不应继续保留在正式能力面里，否则模型会持续被引到一条不稳定路径。

## Occam Check

- 不加它，系统具体坏在哪？
  - 模型仍会继续把 `zai-vision-mcp` 当作正式视觉 provider 候选，走向一条用户已经否定的脆弱路径。
- 用更少的层能不能解决？
  - 能。直接把它从 runtime skill 真相源里退役，不新增替代层。
- 这个改动让主链数量变多了还是变少了？
  - 变少了。视觉正式主线收口为“原生看图 + 本地 LM Studio”。

## Decision

采用最小退役方案：

1. 从 `src/skills/runtime/index.json` 移除 `zai-vision-mcp`
2. 更新 `vision-index/SKILL.md`，只保留原生看图与本地 LM Studio 两条路
3. 在 `runtime-sync.ts` 里把 `zai-vision-mcp` 加入 retired skill 列表，保证旧用户索引不再继续保留它
4. 将 `src/skills/runtime/zai-vision-mcp/` 移到本地 `.trash` 备份，不直接硬删

## Plan

1. 更新 `src/skills/runtime/index.json`、`src/skills/runtime/vision-index/SKILL.md`、`src/skills/README.md`
2. 更新 `src/skills/runtime-sync.ts` 与 `test/p5-7-r13-runtime-skill-sync.test.ts`
3. 将 `src/skills/runtime/zai-vision-mcp/` 移到 `.trash/`
4. 更新 `docs/CHANGELOG.md` 并跑测试

## Risks

1. 用户目录里旧 skill 文件仍存在；回滚/降级：保留 `.trash` 备份，需要时可手动恢复。
2. 未更新所有引用会留下悬挂说明；回滚/降级：以 `rg zai-vision-mcp` 为准补齐收口。

## Test Plan

- `bun test test/p5-7-r13-runtime-skill-sync.test.ts`

（章节级）评审意见：[留空,用户将给出反馈]
