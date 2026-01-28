# E06: 测试与回归（模拟层优先）

## Goal
不依赖真实 iMessage 账号也能回归核心逻辑（路由、去重、队列、发送策略）。

## Scope
- Provider mock：注入 message event，验证状态机
- Golden tests：输入消息序列 → 输出发送动作序列
- 小量集成测试：本机可选（需要权限时标记为 manual）

## Tasks
- [ ] 抽离纯逻辑模块（不直接依赖 osascript/sqlite3）
- [ ] 写 mock provider + fake clock（稳定测试）
- [ ] 覆盖：乱序/重复/高频消息/队列超时/重试冷却

## Acceptance
- CI 或本机一键跑完，能挡住“重复发送/漏处理/死循环”回归。

