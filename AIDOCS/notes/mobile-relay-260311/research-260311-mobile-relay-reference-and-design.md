# 手机端 thin relay 参考与设计记录

> 文档状态：当前关于“手机端专门远程控制入口 / thin relay / reachability 边界”的准则文档。
> 历史说明：更早的相关研究继续保留，但在本主题下仅作为历史推演记录使用；若与本文口径不一致，以本文为准。

## 结论先行

这次从 `Remodex` 得到的核心启发不是“做一个服务端”，而是：

**可以接受一个极薄的 relay，只要它仍然属于 reachability 层，而不是控制面。**

对 `msgcode` 来说，这个判断的意义是：

1. 旧结论里“不要做厚服务器”仍然成立
2. 但“完全不能有中继”不再是必要前提
3. 如果目标是手机端脱离飞书，并且希望全链路安全性更高，那么：
   - `thin relay + local daemon + E2EE`
   - 是一个值得保留的后续实现方向

一句话收口：

**`relay` 可以有，但只能是盲转发跳板，不能长成业务服务端。**

## 仓库内已有相关笔记

### 1. 本地优先移动入口方案研究

- Path: `docs/notes/research-260310-mobile-entry-options.md`
- 既有结论：
  - 当前主线仍是 `Feishu`
  - 下一条值得接的是 `Telegram`
  - 个人远程实验优先 `Tailscale Serve`
  - `Cloudflare Tunnel` 是备选公网入口，不是当时的主线
  - 不应该现在就抄 `OpenClaw` 做完整移动产品

这份研究的价值是：它已经把“手机入口”和“平台化冲动”区分开了。

### 2. 后 iMessage 通道策略

- Path: `docs/design/plan-260310-post-imessage-channel-strategy.md`
- 既有结论：
  - 只允许 `thin channel adapter`
  - 不做 transport platform
  - 不做 channel orchestrator

这意味着：就算未来新增手机端入口，也不能破坏现有统一主链。

### 3. 终局架构节点

- Path: `docs/notes/research-260310-future-architecture-node.md`
- 既有结论：
  - 已明确存在 `Reachability` 这一层
  - 这层只负责触达、访问、深链与远程打开页面/服务
  - 不负责状态真相源和复杂控制逻辑

这给 relay 的归属层提供了现成位置。

### 4. OpenClaw 对标的工程边界

- Path: `docs/design/plan-260310-agent-core-gap-vs-openclaw.md`
- 既有结论：
  - 当前要补的是统一 run lifecycle
  - 当前禁止把 OpenClaw 的 gateway / pairing / control plane 整套搬进来

这条边界非常重要，因为它限制了 relay 的野蛮生长。

### 5. 已有手机端交互事实

- Path: `src/tmux/remote_hint.ts`
- 既有事实：
  - 系统已经有“用户在手机端远程沟通”的专门提示词
  - 说明手机小屏、复制不便、少交互确认，已经是现实使用前提

因此，“手机端”不是幻想需求，只是当前还缺一个更合适的 reachability 方案。

## Remodex 的增量参考

### 它解决的不是业务托管，而是公网 reachability

`Remodex` 的真实主链是：

`Phone -> Relay -> Local Bridge -> Local Codex`

关键点：

- agent 运行在本地
- repo 在本地
- git 操作在本地
- relay 只负责 session 配对和消息转发

所以它证明了一件事：

**“引入中继”不一定会让系统变厚，前提是中继不掌握执行权。**

### 它的安全模型值得借鉴

从参考实现可提炼出这几个关键点：

1. 二维码配对，避免人工抄地址和手工分发密钥
2. relay 只看到连接元数据，不看到业务明文
3. 手机和本地 daemon 之间建立端到端加密
4. 以设备身份和短期会话做信任起点
5. relay 不承担 repo、任务、会话历史的持久化职责

这条路更像：

**传输中继 + 安全配对**

而不是：

**云端 agent 平台**

## 对现有结论的更新

### 不推翻的部分

- 不做厚服务端
- 不做账号系统
- 不做云端执行
- 不做云端状态真相源
- 不做多层控制面
- 不急着做完整手机客户端

这些旧结论全部继续有效。

### 需要补充的新判断

原先我们更偏向：

- `Tailscale Serve` 作为个人远程入口
- `Cloudflare Tunnel` 只作为备选

这次可以补一条更精确的区分：

### 场景 A：页面 / PWA / Web Surface 给手机访问

优先仍是：

- `Tailscale Serve`

原因：

- 更贴近 local-first
- 不需要中心中继
- 更适合个人访问自己的页面和服务

### 场景 B：手机做专门的远程控制端

可以新增一个可接受选项：

- `thin relay`

原因：

- 专门的移动控制端通常需要更稳定的公网可达性
- 二维码配对和长连接天然适合这种形态
- relay 可以部署在：
  - 一个轻量 VPS
  - 本地 relay + `Cloudflare Tunnel`

关键前提是：

- relay 不保存业务正文
- relay 不执行任务
- relay 不掌握 run 状态真相源
- relay 不负责账号和租户系统

## 推荐设计口径

### 设计定位

若未来实现手机端 thin relay，推荐把它定义为：

**手机 reachability 子层**

而不是：

**远程控制平台**

### 最小可删版本

只做下面这些：

1. 本地常驻 `msgcode` daemon / bridge
2. 薄 relay
   - 只做 session 建立
   - 只做双向转发
   - 只维护短期内存态
3. 二维码配对
4. 手机和本地 daemon 之间的端到端加密
5. 单手机 + 单主机
6. 最小能力面：
   - 发消息
   - 看最新结果
   - 看任务状态
   - 取消当前运行
   - 上传小附件

### 不该在第一版出现的东西

- 账号系统
- 云端历史同步
- 云端任务队列
- 多设备编排
- 远程运行真相源
- 云端 memory / artifact 托管
- 多租户
- 复杂权限平台

## Occam Check

### 不加 thin relay，系统具体坏在哪？

如果目标只是“个人手机访问本机页面”，不一定坏，`Tailscale Serve` 足够。

但如果目标是：

- 做专门的手机端控制壳
- 不依赖飞书
- 还要兼顾公网可达性与稳定长连接

那么只靠 `Tailscale Serve` 或聊天通道，会限制体验和配对路径。

### 用更少的层能不能解决？

能。

最少层数应是：

- 手机端
- local bridge / daemon
- thin relay

不要再加：

- control plane
- scheduler server
- state manager
- cloud sync layer

### 这个改动让主链数量变多了还是变少了？

如果 relay 保持盲转发，它不会新增业务主链，只是给 reachability 增加一个实现选项。

如果 relay 长出状态、权限、编排、同步，它就会把主链变多，必须禁止。

## 对后续实现的推荐顺序

1. 继续保持现有主线：
   - `Feishu` 作为当前正式入口
2. 继续保留旧实验线：
   - `Tailscale Serve` / Web Surface
3. 当你真要做“脱离飞书的手机端”时，再开 thin relay 分支
4. 第一版默认优先：
   - `self-hosted VPS relay`
5. `local relay + Cloudflare Tunnel` 作为可选部署，不作为唯一前提

原因：

- VPS relay 更直、更稳、更容易排障
- `Cloudflare Tunnel` 适合作为本地部署补充，不适合作为唯一心智

## 后续开工时的切入点

等后面真要做时，建议先回答这 5 个问题：

1. 手机端是原生壳、PWA，还是先做极简控制页？
2. 本地 daemon 暴露给手机的最小 contract 是什么？
3. relay 的 session 模型是否只允许 `1 host + 1 phone`？
4. E2EE 的配对和重连真相源放在哪？
5. 哪些状态必须留在本地，哪些可以只在 relay 内存里短暂存在？

## 证据

### Docs

- `docs/notes/research-260310-mobile-entry-options.md`
- `docs/design/plan-260310-post-imessage-channel-strategy.md`
- `docs/notes/research-260310-future-architecture-node.md`
- `docs/design/plan-260310-agent-core-gap-vs-openclaw.md`

### Code

- `src/tmux/remote_hint.ts`

### Reference

- `/Users/admin/GitProjects/GithubDown/remodex/README.md`
- `/Users/admin/GitProjects/GithubDown/remodex/phodex-bridge/src/bridge.js`
- `/Users/admin/GitProjects/GithubDown/remodex/relay/relay.js`
