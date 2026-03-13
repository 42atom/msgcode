# Contributing

## 先认边界

这个仓库的核心原则是：**做薄，不抢 LLM 的执行权。**

请先记住四句：

1. msgcode 是薄 runtime，不是控制平台
2. 当前桌面能力面是 `ghost_*`
3. 最终产品方向是：`menu App + 单面板 + web系统面板`
4. msgcode 不自研点击、识别、grounding 这一类桌面自动化供应逻辑

## 文档分工

- `docs/`
  - 正式真相源
  - 放 issue plan 对应的设计、正式变更日志、协议口径
- `AIDOCS/`
  - 辅助材料区
  - 放 review、report、notes、历史档案
  - 默认不等于正式协议

如果一个结论已经进入正式决策，请把它固化到：
- `issues/`
- `docs/design/`
- `docs/CHANGELOG.md`

不要让关键规则只停留在 `AIDOCS/`。

## 代码边界

- 工具执行统一走 `src/tools/bus.ts`
- 不要绕过 Bus 直接从 route、runtime 或 prompt 层私接 runner
- Runner 负责桥接真实能力，不负责另造控制面
- 如果已有主链能表达需求，不要再补一层 adapter、controller、manager、supervisor

## 桌面自动化边界

- `ghost-os` 是默认且唯一的桌面自动化桥
- msgcode 负责：
  - 配置收口
  - 工具暴露
  - 结果回传
  - 最小诊断
- msgcode 不负责：
  - 自研点击逻辑
  - 自研识别逻辑
  - 自研视觉定位逻辑
  - 自研“自动化供应”能力

## 本地私有文件

下面这些是本地私有或机器态文件，不应进入开源仓库：

- `.claude/`
- `.trash/`
- `CLAUDE.md`
- `AGENTS.md`
- 运行时 artifacts

## 提交前

至少确认：

```bash
npx tsc --noEmit
npm run docs:check
```

如果你改了对外能力、运行时行为或正式口径，记得同步：

- `issues/`
- `docs/design/`
- `docs/CHANGELOG.md`
