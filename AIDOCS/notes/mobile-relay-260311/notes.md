# Notes: Mobile Relay Reference And Design Capture

## Sources

### Source 1: 现有移动入口研究
- Path: `docs/notes/research-260310-mobile-entry-options.md`
- Key points:
  - 当前冻结主线仍是 `Feishu -> Telegram -> Discord`
  - 旧结论更偏向 `Tailscale Serve` 个人远程实验
  - `Cloudflare Tunnel` 被定义为公网入口备选，不是当时的主线
  - 明确不建议直接照抄 `OpenClaw` 的完整手机客户端 / gateway 形态

### Source 2: 后 iMessage 通道策略
- Path: `docs/design/plan-260310-post-imessage-channel-strategy.md`
- Key points:
  - 通道层只允许做 `thin channel adapter`
  - 不做 transport platform / channel orchestrator
  - Feishu 是当前唯一主通道，未来通道继续复用同一条内部主链

### Source 3: 终局架构节点
- Path: `docs/notes/research-260310-future-architecture-node.md`
- Key points:
  - 已经把 `Reachability` 单独画成一层
  - 该层只负责触达、访问、深链跳转、远程打开页面/服务
  - 该层不负责 agent 本体、状态真相源和复杂控制逻辑

### Source 4: OpenClaw 对标的边界结论
- Path: `docs/design/plan-260310-agent-core-gap-vs-openclaw.md`
- Key points:
  - `msgcode` 需要补的是统一 run lifecycle，不是先做 gateway
  - 当前明确禁止直接引入 OpenClaw 式 pairing / control plane / platform

### Source 5: 现有手机端交互提示
- Path: `src/tmux/remote_hint.ts`
- Key points:
  - 系统已经承认“手机端远程使用”是现实场景
  - 当前优化点只停留在 prompt 级别，还没有独立的 mobile reachability 方案

### Source 6: Remodex 参考
- Paths:
  - `/Users/admin/GitProjects/GithubDown/remodex/README.md`
  - `/Users/admin/GitProjects/GithubDown/remodex/phodex-bridge/src/bridge.js`
  - `/Users/admin/GitProjects/GithubDown/remodex/relay/relay.js`
- Key points:
  - 主链是 `iPhone -> relay -> local bridge -> local codex`
  - relay 只做 session 配对与密文转发，不跑 agent、不持有 repo
  - 配对依赖二维码、设备身份和端到端加密
  - 这证明“有 relay”并不必然等于“重新做厚服务端”

## Synthesized Findings

### 既有结论
- 仓库里已经有明确的 mobile / remote access 思考，不是空白领域。
- 旧结论的主防线是：不要为了手机端把系统拉向新的平台层。
- 旧研究更偏向 `Tailscale Serve`，原因是它更接近 local-first，且不需要自建常驻中心服务。

### 这次的新增启发
- `Remodex` 补了一个之前没有被充分展开的选项：`thin relay`
- 关键不在于“有没有服务器”，而在于：
  - relay 是否只做 reachability
  - relay 是否不持有业务明文
  - relay 是否不持有执行状态真相源
  - relay 是否不替 agent 做决策

### 对旧结论的更新方式
- 旧结论并没有被推翻。
- 更准确的收口应该变成两条并行口径：
  - `PWA / page remote access`：`Tailscale Serve` 仍是更优先的个人远程实验
  - `dedicated mobile remote control app`：thin relay 成为一个可以接受的新选项

### 应避免的误区
- 不要把 relay 扩成账号系统、同步平台或云端任务控制面
- 不要让 relay 成为 run 状态真相源
- 不要一开始就做多手机、多主机、多租户
- 不要把“安全”理解成“只要自己部署了 VPS 就安全”，真正的边界仍应是端到端加密
