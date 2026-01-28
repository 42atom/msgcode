# E05: 可观测性（probe/health/结构化日志）

## Goal
让“坏了”变成可诊断、可自动处理：用 probe 把环境问题前置暴露。

## Scope
- `probe`: 权限/依赖/账号登录状态/二进制可用性
- `healthz`: 运行时心跳（可选 HTTP 或写日志指标）
- 日志结构化：关键事件统一字段（chatId、provider、latency、result）

## Tasks
- [ ] `msgcode doctor`（或 `msgcode probe`）输出机器可解析 JSON
- [ ] 启动时 probe：失败时给出明确操作指引
- [ ] 运行时 health：检测 provider 停摆、队列堆积、发送失败风暴

## Acceptance
- 看到 probe 输出就能定位是“权限/登录/二进制/网络/配置”哪类问题。

