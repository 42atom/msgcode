# subagent real bdd run 260312 r1

## 任务

验证 `msgcode subagent run claude-code --watch` 是否会等到真实完成标记后再返回，而不是把“tmux 已回话”误判为完成。

## 工作目录

- `/Users/admin/msgcode-workspaces/test-real`

## BDD 用例

自然语言目标：

> 在当前工作目录创建一个项目目录 `snake-html-20260312-r2`，做一个可直接打开运行的贪吃蛇 HTML 游戏。至少产出 `index.html`、`style.css`、`game.js`。完成后不要额外解释。

执行命令：

```bash
node --import tsx src/cli.ts subagent run claude-code \
  --workspace /Users/admin/msgcode-workspaces/test-real \
  --goal "在当前工作目录创建一个项目目录 snake-html-20260312-r2，做一个可直接打开运行的贪吃蛇 HTML 游戏。至少产出 index.html、style.css、game.js。完成后不要额外解释。" \
  --watch \
  --timeout-ms 240000 \
  --json
```

## 结果

- `taskId`: `decca6be-fa20-4adf-8080-1e1a0e303923`
- `client`: `claude-code`
- `status`: `completed`
- `durationMs`: `64835`

说明：

- 新语义下，`--watch` 没有在“已切换目录”时提前返回
- 它一直等到 `MSGCODE_SUBAGENT_DONE decca6be-fa20-4adf-8080-1e1a0e303923` 出现在 pane tail 才结束

## 证据

### Task JSON

- `/Users/admin/msgcode-workspaces/test-real/.msgcode/subagents/decca6be-fa20-4adf-8080-1e1a0e303923.json`

### 产物文件

- `/Users/admin/msgcode-workspaces/test-real/snake-html-20260312-r2/index.html`
- `/Users/admin/msgcode-workspaces/test-real/snake-html-20260312-r2/style.css`
- `/Users/admin/msgcode-workspaces/test-real/snake-html-20260312-r2/game.js`

### 状态查询

```bash
node --import tsx src/cli.ts subagent status decca6be-fa20-4adf-8080-1e1a0e303923 \
  --workspace /Users/admin/msgcode-workspaces/test-real \
  --json
```

关键观测：

- `status = completed`
- `paneTail` 中明确出现：
  - `MSGCODE_SUBAGENT_DONE decca6be-fa20-4adf-8080-1e1a0e303923`

## 结论

这次真实验收证明：

1. `subagent --watch` 已不再把同步响应误判成完成
2. `claude-code` 子代理在 `test-real` 中能真实完成一个小型 HTML 游戏项目
3. `watch` 语义已与“监控直到完成标记”为止的设计目标对齐
