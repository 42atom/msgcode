# 飞书 Live Smoke

## 目的

这份文档只承接一件事：

- 当仓库里提到“飞书真机 smoke / live verification”时，默认基座是什么

它不是新协议，只是把既有口径从入口文档里拆出来，避免 `README.md` 重复背负维护细节。

## 默认基座

- 现成群：优先复用已有 `test-real` 飞书群，不重新建测试群
- 真实凭据：优先使用本机 `~/.config/msgcode/.env`
- 默认 workspace：`/Users/admin/msgcode-workspaces/test-real`
- 默认真相源：`docs/plan/pl0098.dne.feishu.feishu-live-verification-loop.md`
- 现成证据：
  - `AIDOCS/reports/skill-live-run-260312-batch1.md`
  - `AIDOCS/reports/skill-live-run-260312-batch2.md`

## 默认流程

1. 先检查环境与凭据：

```bash
msgcode preflight
```

2. 启动服务：

```bash
msgcode start
```

3. 直接去 `test-real` 群发真实消息，按待验收场景执行

## 约束

- 不把 bot 自发 API 消息当成完整真机验证
- 不优先做 Feishu UI 自动化
- 做 capability live test 前，先检查 `test-real/.msgcode/config.json` 的 `tooling.allow` 是否已打开所需工具面

## 适用边界

这份基座默认服务：

- 飞书通道回归
- live verification
- 真实 skill/tool/browser/file 回传验证

不替代：

- `npm test`
- `bun test`
- BDD 或本地行为锁

## 负向 Smoke 口径

默认不把“入口拦截成功”当成通过。

负向 smoke 的默认通过条件是：

- 真实执行已发生
- 真实底层错误已进入证据面与模型上下文
- 模型看到的是原始错误事实，而不是系统代答

仅以下三类边界允许入口 fail-closed：

- 安全边界
- 预算边界
- 工具启动前物理不可达

例子：

- 不存在命令 -> `exitCode=127` + `command not found`
- 不存在文件 -> `ENOENT`

## 相关入口

- 根入口：`README.md`
- 测试结构：`test/README.md`
- 文档导航：`docs/README.md`
