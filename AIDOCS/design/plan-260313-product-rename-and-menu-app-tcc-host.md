# 未来计划：正式命名与 Menu App 作为 TCC 权限宿主

## Problem

当前 msgcode 的后台 daemon 由 launchd 以 `node` 作为宿主进程拉起（`ProgramArguments[0]=/opt/homebrew/.../bin/node`），导致 macOS 的 TCC 权限页（Accessibility / Screen Recording）里经常只显示成 “node”。这对用户不够有识别性，典型负反馈是：

- 用户以为自己“已经授权了 Terminal”，但 daemon 宿主仍无权限，桌面能力调用失败。
- 用户看不到清晰的“该勾选哪个宿主”，只会得出“程序有 bug / 卡住了”的结论。

## Goal / Non-Goals

- Goal
  - 将“桌面权限宿主”从不显眼的 `node` 收口成一个对用户可识别的主体。
  - 最终对外的正式身份以 **`menu App + 单面板 + web系统面板`** 为核心结构，Menu App 成为 TCC 权限页中的可见宿主。
  - 允许 CLI 继续存在，但不要求它承担“可见宿主”的责任。
- Non-Goals
  - 不在当前迭代立即完成全命名空间改名（CLI 命令名 / 配置目录 / launchd label 全改）。
  - 不引入新的全局 gate/审批/拦截层来“替用户或模型做主”。

## Occam Check

- 不加它，系统具体坏在哪？
  - 用户无法可靠完成授权，桌面能力调用时才失败，失败体验类似“程序卡住/有 bug”。
- 用更少的层能不能解决？
  - 仅靠文档和错误提示可缓解，但无法解决“系统设置列表里只有 node”的识别性问题。
  - 增加一个可见宿主（Menu App）比发明更多控制层更贴近问题本质。
- 这个改动让主链数量变多了还是变少了？
  - 目标是减少“隐式权限主链”的分叉：把权限宿主收口成一个明确主体（Menu App），让权限路径变少。

## Decision

1. **将 Menu App 作为对外正式身份与 TCC 权限宿主**。
2. CLI 与 daemon 继续保持“做薄”：CLI 用于运维/诊断/开发；桌面权限与用户心智以 App 为主。
3. “改名字（正式发布名）”优先落在 App 层（App 名称 + Bundle ID + UI 展示名），而不是先强行改 CLI 命令名。

## Plan（分阶段）

### Phase 0：冻结命名与范围

- 决定“正式发布名”（Product Name）。
- 决定 macOS App 的 Bundle ID（不可轻易更改）。
- 约定对外口径：App 是桌面权限宿主；CLI 是运维工具。

### Phase 1：最小 Menu App Host（只做宿主）

- 目标：Menu App 启动后承载 daemon（或通过现有 daemon 入口拉起），并在首次运行时触发 TCC 权限请求入口。
- 约束：App 不引入新的 manager/controller/policy 层；不重写 tool bus/tool-loop。
- 产物：
  - App：可被用户在系统设置里清晰识别并授权。
  - 文档：安装/升级/授权流程对齐到 App。

### Phase 2：单面板与 web 系统面板（逐步演进）

- 单面板：提供最小可用的状态/日志/工作区入口（读多写少）。
- web 系统面板：承载更复杂的观测与配置，但仍保持“做薄脑”的原则。

### Phase 3：是否需要全命名空间改名（大版本迁移）

若未来确需全量改名，再做一次大版本迁移，包含：

- CLI 命令名
- `~/.config/<name>` 配置目录
- launchd label
- 文档与示例命令
- Homebrew/distribution 名称

迁移策略优先选“安装层/文件层重定向”（如 symlink/迁移脚本）而不是代码里的幽灵兼容分支。

## Risks

- 分发与签名：Menu App 需要稳定的签名与升级路径，否则 TCC 授权会反复丢失或变得不可控。
- 迁移成本：全命名空间改名会影响脚本与现有用户目录，必须一次性规划清楚并提供可回滚路径。
- 心智割裂：如果同时存在 CLI 名称与 App 名称不一致，需要明确“正式对外名”与“内部工具名”的关系，避免未来维护者困惑。

## Notes（事实锚点）

- launchd label：`ai.msgcode.daemon`
- 当前 daemon 宿主典型路径：`/opt/homebrew/Cellar/node/.../bin/node`
- 配置目录：`~/.config/msgcode`
