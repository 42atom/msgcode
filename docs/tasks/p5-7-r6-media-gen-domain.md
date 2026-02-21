# 任务单：P5.7-R6（多模态域：media + gen）

优先级：P1（R5 通过后执行）

## 目标（冻结）

1. 落地 `media screen`（本地截图）。
2. 落地 `gen image` / `gen selfie`（图片生成）。
3. 落地 `gen tts` / `gen music`（语音与音乐拆分）。
4. 统一 Envelope + 错误码口径 + `help-docs --json` 合同可发现。

## Provider 冻结（本单临时口径）

1. `gen image` / `gen selfie`：固定使用 **Banana Pro**，鉴权使用 `GEMINI_API_KEY`。
2. 本单不做图片 provider 自动切换，不走 MiniMax 图片链路。
3. 若缺少 `GEMINI_API_KEY`，必须返回固定错误码（建议：`GEN_API_KEY_MISSING`）。
4. `gen tts` / `gen music` 维持既有音频后端口径（不受本冻结影响）。

## 依赖

1. 依赖本地截图执行路径。
2. 图片侧依赖 Banana Pro（`GEMINI_API_KEY`）；音频侧依赖现有后端。
3. 不在本单扩展 provider 体系，只接现有能力。

## 范围

- `/Users/admin/GitProjects/msgcode/src/cli/media.ts`
- `/Users/admin/GitProjects/msgcode/src/cli/gen.ts`
- `/Users/admin/GitProjects/msgcode/src/cli/help.ts`
- `/Users/admin/GitProjects/msgcode/test/*p5-7-r6*`
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`

## 非范围

1. 不改 browser/agent 域。
2. 不改底层 provider 架构。

## 执行步骤（每步一提交）

1. `feat(p5.7-r6): add media screen command`
2. `feat(p5.7-r6): add gen image and gen selfie commands`
3. `feat(p5.7-r6): add gen tts and gen music commands`
4. `test(p5.7-r6): add media-gen regression lock`

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `help-docs --json` 可发现 media/gen
5. 真实成功证据：screen 成功 + 任一 gen 成功
6. 真实失败证据：缺失必要参数 / provider 不可用错误
7. 无新增 `.only/.skip`
