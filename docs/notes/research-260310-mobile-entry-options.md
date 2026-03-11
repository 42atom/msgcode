# 本地优先移动入口方案研究

> 历史说明：本文保留为 2026-03-10 的阶段性研究记录。
> 关于“手机端专门远程控制入口 / thin relay / reachability 边界”的当前口径，改以 [AIDOCS/notes/mobile-relay-260311/research-260311-mobile-relay-reference-and-design.md](/Users/admin/GitProjects/msgcode/AIDOCS/notes/mobile-relay-260311/research-260311-mobile-relay-reference-and-design.md) 为准；本文在该主题下仅作历史参考。

## 背景

`msgcode` 当前已经明确进入 `Feishu-first, iMessage-optional`，后续方向也已冻结为：

- 当前主通道：Feishu
- 未来通道：Telegram、Discord
- iMessage：legacy / sunset

但用户仍有一个明确愿望：希望像 `openclaw` 一样，最终能在手机上顺手地使用自己的智能体，同时又不想过早引入厚服务器、账号系统、多端同步平台。

本研究只回答一个问题：

**在坚持 local-first、系统做薄、尽量不新增平台层的前提下，什么移动入口方案最值得借鉴？**

## 结论先行

推荐结论：

1. **短期主线继续是 Feishu，下一条最值得接的是 Telegram。**
2. **如果想做“手机直连自己本机智能体”的实验路线，优先考虑 `Tailscale Serve`，不是 Cloudflare Tunnel。**
3. **Cloudflare Tunnel 可以做，但它不是 P2P，本质是 edge relay，适合作为备选公网入口，不适合作为当前主线。**
4. **Discord 先放后面，它比 Telegram 明显更重。**
5. **现在不该做完整手机客户端；先把系统做成 mobile-ready，再决定要不要做 app。**

一句话推荐：

**通道侧走 `Feishu -> Telegram -> Discord`；本机远程侧走 `Tailscale Serve` 小实验；不要现在就做 OpenClaw 式完整移动产品。**

## 评价标准

本研究按 5 个维度比较：

- 是否符合 local-first
- 是否需要新增常驻服务器
- 接入复杂度
- 手机端体验
- 是否会把 `msgcode` 推向新的控制面/平台层

## 路线一：继续把现成聊天通道当手机客户端

### 1.1 Feishu

这是当前最现实、最符合主线的方案。

优点：

- 已经是当前正式主通道
- 用户直接用现成手机 App
- 不需要额外服务器产品
- 已有 route / workspace / 附件 / schedule 主链

缺点：

- 体验受限于飞书产品形态
- 不属于“专为智能体设计”的移动入口

判断：

**这仍然是当前最优主线。**

### 1.2 Telegram

这是未来最值得优先接的下一通道。

官方文档显示，Telegram Bot API 同时支持：

- `getUpdates` 长轮询
- `setWebhook` 出站 webhook

而且 `getUpdates` 明确就是“接收入站更新的 long polling 方法”，不要求你先搭公网入口。  
来源：Telegram Bot API 官方文档 `getUpdates` / `setWebhook`

优点：

- 手机端天然成熟
- bot API 简单，HTTP 为主
- 可以先用 long polling，不强制先搭服务器
- 适合 `thin adapter`

缺点：

- 仍是“借壳聊天软件”，不是专属客户端
- 权限、群能力、文件尺寸等仍受平台约束

判断：

**Telegram 是最适合作为下一条薄通道的选择。**

### 1.3 Discord

Discord 也能做，但明显比 Telegram 更重。

官方文档给了两条典型路线：

- 走 Gateway：需要维护持久 WebSocket、heartbeat、resume、reconnect
- 走 Interactions HTTP：可以少管部分实时连接，但必须在 3 秒内回初始响应

官方文档原文含义很明确：

- Gateway 连接“比普通 HTTP 请求更复杂”
- Interactions token 有效 15 分钟，但**初始响应必须 3 秒内返回**

优点：

- 社区/群组生态强
- 机器人和工作流生态成熟

缺点：

- 协议复杂度明显高于 Telegram
- 对实时连接和交互时限更敏感
- 容易把系统推向更厚的 bot runtime

判断：

**Discord 可以做，但不应该排在 Telegram 前面。**

## 路线二：本机通过远程入口直接给手机访问

这条路的目标不是“接入第三方聊天通道”，而是：

**让手机直接访问用户自己那台长期在线的 `msgcode` 主机。**

### 2.1 Cloudflare Tunnel

Cloudflare 官方文档说明：

- `cloudflared` 在本机建立到 Cloudflare 的 **outbound-only** 连接
- 不需要本机拥有公网 IP
- Cloudflare Tunnel 可把 HTTP、SSH、RDP 等服务安全接到 Cloudflare

这说明它解决的是：

- 无公网 IP
- 出口穿透
- 暴露本地服务

但它不是：

- 纯 P2P
- 手机直接和本机裸连

本质上仍然是：

**手机 -> Cloudflare 边缘 -> 本机 tunnel**

优点：

- 没有公网 IP 也能暴露服务
- 本机只需出站连接
- 很适合快速做公网入口实验

缺点：

- 不是 P2P
- 会引入 Cloudflare 边缘与鉴权心智
- 一旦继续做通知/登录/多设备，会自然长出服务端复杂度

判断：

**Cloudflare Tunnel 适合作为“公网入口备选”，不适合作为当前首选。**

### 2.2 Tailscale Serve / Funnel

OpenClaw 在远程访问上重点采用的就是这条思路。

从 OpenClaw README 可以看到：

- 它明确支持 `Tailscale Serve/Funnel`
- 也把这条路线作为 Gateway dashboard / WS 的远程接入方式

而 Tailscale 官方文档说明：

- `tailscale serve` 可以把本地 HTTP/HTTPS/TCP 服务暴露给 **tailnet 内其他设备**
- `tailscale funnel` 可以把流量从更广的互联网导向 tailnet 中某台设备上的本地服务
- `serve -bg` 可以后台持久运行，并在设备重启或 Tailscale 重启后自动恢复分享

这条路线的关键意义在于：

- `Serve` 是 **tailnet-only**
- 比公网 tunnel 更符合 local-first / 私密使用
- 很适合“单用户手机访问自己本机”

优点：

- 更接近本地优先
- 比公网暴露更私密
- 不需要自建中心服务器
- 对“个人随时查看任务/发消息/上传附件”很合适

缺点：

- 用户需要 Tailscale
- 更适合个人/小团队，不是公网大众产品入口

判断：

**如果要试“手机访问自己本机智能体”，优先应该试 `Tailscale Serve`。**

### 2.3 这是不是 P2P

严格说都不是纯 P2P。

- Cloudflare Tunnel：显然不是，是边缘中继
- Tailscale：更接近“私有 overlay 网络上的受控访问”

但从产品上看，`Tailscale Serve` 已经足够接近你想要的那种：

**用户在手机上访问自己那台本机智能体，而不需要先搭一个 SaaS 服务器。**

## 路线三：直接做 OpenClaw 式手机客户端

OpenClaw 最吸引人的地方，不是单个功能，而是它把下面这些揉到了一起：

- 多通道
- Gateway 常驻
- Tailscale 远程访问
- iOS / Android node
- 配对 / 鉴权 / 控制 UI

这个产品完成度很高，但它的代价也很明显：

- 必须有长期网关心智
- 有 pairing / discovery / remote gateway
- 有节点生命周期、远程 UI、设备侧能力面

对 `msgcode` 当前阶段来说，直接照抄它会出两个问题：

1. 系统会迅速从“薄主链”滑向“控制面平台”
2. 研发重心会从 Feishu 主线转到移动基础设施

判断：

**OpenClaw 适合作为灵感来源，不适合作为当前实施模板。**

## 值得借鉴什么，不该借鉴什么

### 值得借鉴

1. **保活交给系统服务管理器**
   - 这一点已经在 `msgcode` 上落成 `launchd`

2. **远程访问优先走现成网络能力**
   - OpenClaw 借 Tailscale，而不是先自建公网网关平台

3. **通道是薄适配，不是 transport platform**
   - 这和 `msgcode` 现在定下的方向一致

### 不该现在借鉴

1. 完整 Gateway 控制面
2. 原生 iOS / Android 节点体系
3. 配对系统 / 远程控制 UI / 设备管理平台

## 推荐路线

### 推荐主线

1. **继续把 Feishu 打磨成主通道**
2. **下一条薄接入通道做 Telegram**
3. **把 Discord 放在 Telegram 之后**

理由：

- Feishu 已经有真实主链
- Telegram API 简单、手机端成熟、无需先上服务器
- Discord 协议明显更重

### 推荐实验线

并行保留一条小实验：

**做一个仅供个人使用的 mobile web / PWA，通过 `Tailscale Serve` 暴露给手机访问。**

这个实验只做：

- 发一条消息
- 看最新回执
- 看任务状态
- 上传小附件

不做：

- 推送
- 多用户
- 账号系统
- 云端同步平台
- 原生 App

## 最小实施建议

### Phase A：通道主线

- Feishu 继续主线优化
- Telegram 作为下一通道接入
  - 先走 long polling
  - 不先要求 webhook / 公网入口

### Phase B：个人远程实验

- 增加一个极薄本地 HTTP / WebSocket 入口
- 只暴露当前会话、任务状态、发消息、收结果
- 用 `Tailscale Serve` 暴露给手机

### Phase C：晚点再看

- Discord
- Cloudflare Tunnel 公网暴露
- 原生手机客户端

## 最终建议

最终建议只有一句：

**别先做手机客户端；先把 `msgcode` 做成“可被手机消费”的系统。**

对当前阶段最有启发、又最不容易把系统做厚的组合是：

- **主线：Feishu**
- **下一通道：Telegram**
- **个人远程实验：Tailscale Serve**
- **暂缓：Cloudflare Tunnel 公网化、Discord、原生 App**

## 证据

### Docs

- Cloudflare Tunnel 官方文档：`Cloudflare Tunnel provides ... without a publicly routable IP address`，并说明 `cloudflared` 建立 `outbound-only connections`
  - https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/
- Tailscale Serve 官方文档：支持本地 HTTP / HTTPS / TCP 暴露，`-bg` 可持久后台运行并在重启后恢复
  - https://tailscale.com/docs/reference/tailscale-cli/serve
- Tailscale Funnel 官方文档：可把更广互联网流量导到 tailnet 中设备上的本地服务；仅 tailnet 内访问应使用 Serve
  - https://tailscale.com/docs/features/tailscale-funnel
- Telegram Bot API 官方文档：`getUpdates` 长轮询、`setWebhook` webhook，二者互斥
  - https://core.telegram.org/bots/api
- Discord 官方文档：
  - Gateway 需要持久 WebSocket / heartbeat / reconnect
  - Interactions HTTP 首响 3 秒限制
  - https://docs.discord.com/developers/events/gateway
  - https://docs.discord.com/developers/interactions/receiving-and-responding

### Code

- `msgcode` 当前正式方向：
  - [docs/design/plan-260310-feishu-first-imsg-optional.md](/Users/admin/GitProjects/msgcode/docs/design/plan-260310-feishu-first-imsg-optional.md)
  - [docs/design/plan-260310-post-imessage-channel-strategy.md](/Users/admin/GitProjects/msgcode/docs/design/plan-260310-post-imessage-channel-strategy.md)
- 当前通道代码现状：
  - [src/feishu/transport.ts](/Users/admin/GitProjects/msgcode/src/feishu/transport.ts)
  - [src/imsg/rpc-client.ts](/Users/admin/GitProjects/msgcode/src/imsg/rpc-client.ts)
  - [src/config/transports.ts](/Users/admin/GitProjects/msgcode/src/config/transports.ts)

### Reference

- OpenClaw README：多通道、iOS/Android、Tailscale Serve/Funnel、gateway 远程访问
  - [/Users/admin/GitProjects/GithubDown/openclaw/README.md](/Users/admin/GitProjects/GithubDown/openclaw/README.md)
- Alma Telegram skill：Telegram 作为薄能力面可直接通过 Bot API 使用
  - [/Users/admin/.config/alma/skills/telegram/SKILL.md](/Users/admin/.config/alma/skills/telegram/SKILL.md)
