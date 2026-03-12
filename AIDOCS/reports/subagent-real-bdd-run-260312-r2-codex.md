# subagent-real-bdd-run-260312-r2-codex

## 目标

验证 `msgcode subagent run codex --watch` 在 fresh-session 场景下不再因为 JSONL 尚未生成而抢跑失败，并能完成真实 `test-real` 工作区任务。

## 环境

- 仓库：`/Users/admin/GitProjects/msgcode`
- 工作区：`/Users/admin/msgcode-workspaces/test-real`
- 执行臂：`codex`
- 模式：`subagent run ... --watch`

## Case 1: 最小文件创建 smoke

命令：

```bash
node --import tsx src/cli.ts subagent run codex \
  --workspace /Users/admin/msgcode-workspaces/test-real \
  --goal "在当前工作目录创建文件 codex-subagent-smoke-20260312-r2.txt，内容精确为 CODEX_SUBAGENT_OK。完成后不要额外解释。完成时输出 MSGCODE_SUBAGENT_DONE。" \
  --watch --timeout-ms 120000 --json
```

结果：

- taskId: `08348227-aec0-4158-823f-b4d4e1d95e1d`
- status: `completed`
- 产物：
  - `/Users/admin/msgcode-workspaces/test-real/codex-subagent-smoke-20260312-r2.txt`
- 内容：
  - `CODEX_SUBAGENT_OK`

证据：

- task JSON：
  - `/Users/admin/msgcode-workspaces/test-real/.msgcode/subagents/08348227-aec0-4158-823f-b4d4e1d95e1d.json`
- pane 尾部出现：
  - `MSGCODE_SUBAGENT_DONE 08348227-aec0-4158-823f-b4d4e1d95e1d`

## Case 2: 项目级贪吃蛇 HTML 游戏

命令：

```bash
node --import tsx src/cli.ts subagent run codex \
  --workspace /Users/admin/msgcode-workspaces/test-real \
  --goal "在当前工作目录创建一个新目录 snake-html-codex-r1，里面实现一个可直接打开运行的贪吃蛇 HTML 游戏。至少生成 index.html、style.css、game.js。游戏要支持方向键控制、得分显示、撞墙或撞到自己后结束，并提供重新开始方式。完成后自行检查这三个文件都存在，再输出完成标记。" \
  --watch --timeout-ms 300000 --json
```

结果：

- taskId: `f16c25b6-a7b6-4ed1-bc20-441ce341f9c0`
- status: `completed`
- 产物目录：
  - `/Users/admin/msgcode-workspaces/test-real/snake-html-codex-r1`
- 关键文件：
  - `/Users/admin/msgcode-workspaces/test-real/snake-html-codex-r1/index.html`
  - `/Users/admin/msgcode-workspaces/test-real/snake-html-codex-r1/style.css`
  - `/Users/admin/msgcode-workspaces/test-real/snake-html-codex-r1/game.js`

证据：

- task JSON：
  - `/Users/admin/msgcode-workspaces/test-real/.msgcode/subagents/f16c25b6-a7b6-4ed1-bc20-441ce341f9c0.json`
- pane 尾部出现：
  - `MSGCODE_SUBAGENT_DONE f16c25b6-a7b6-4ed1-bc20-441ce341f9c0`

## 观察

1. fresh-session 场景下，Codex 已能等到 JSONL 准备好后再进入主链，不再直接 `SUBAGENT_DELEGATE_FAILED`。
2. `--watch` 的最终 `response` 字段仍偏过程性，不宜单独作为完成判据。
3. 当前真正可靠的验收信号是：
   - task JSON `status=completed`
   - pane marker
   - 真实文件/目录落盘

## 结论

这次修补已达成目标：

- Codex fresh-session 的 delegate 时序已修正
- 最小 smoke 和项目级 BDD 均已通过
- 当前 `subagent codex` 主链可继续向更高层的主脑编排能力推进
