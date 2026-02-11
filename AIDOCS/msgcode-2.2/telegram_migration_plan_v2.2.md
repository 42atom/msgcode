# msgcode v2.2 Telegram 切换计划

> 目标：从高风控入口（iMessage GUI 自动化）迁移到官方 API 入口（Telegram Bot），保持编排层与工具层不变，降低封禁风险与维护成本。

---

## 1) 结论先行

- 迁移可行，且建议执行。
- 采用“入口替换、内核复用”路线：只替换消息收发适配层，不动 `Tool Bus / Desktop Bridge / Recipe` 核心。
- 先灰度双跑，再主切 Telegram，最后保留 iMessage 作为应急回退。

---

## 2) 迁移边界

### 保持不变（复用）

- 工作区路由与 session 体系
- `policy.mode` / `tooling.allow` / 审计日志
- Desktop Host/Bridge（observe/find/click/type/hotkey/wait/abort）
- Recipe 执行链与证据落盘

### 需要新增/改造（入口层）

- Telegram inbound adapter（收消息、会话键、用户身份）
- Telegram outbound adapter（文本/附件/回执）
- Telegram 配置加载与 allowlist
- slash 命令在 Telegram 的输入形态兼容

---

## 3) 架构映射

```text
Telegram Bot API (inbound/outbound)
        ↓
Channel Adapter (telegram)
        ↓
Route + Session + Policy (现有)
        ↓
Runner / Tool Bus / Desktop Bridge (现有)
        ↓
Artifacts + Audit (现有)
```

核心原则：Channel Adapter 只做“协议翻译”，不承载业务逻辑。

---

## 4) 配置草案（最小可用）

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "env:TELEGRAM_BOT_TOKEN",
      "mode": "polling",
      "allowFrom": ["123456789"],
      "groups": {
        "*": { "requireMention": true }
      },
      "historyLimit": 50,
      "textChunkLimit": 4000
    }
  }
}
```

说明：

- 生产环境优先使用环境变量注入 token。
- 群场景建议默认 `requireMention=true`，避免误触发。

---

## 5) 分批任务单（给执行代理）

## Batch-TG1（P0）入口打通

- 新增 Telegram adapter（inbound/outbound）
- 完成消息模型映射（chatId/userId/messageId/text/media）
- 打通 `/help /status /where /model /policy /reload`

验收标准：

- Telegram 私聊可收发消息
- slash 命令在 Telegram 可执行
- `npm run test:all` 全绿

## Batch-TG2（P0）安全收口

- 增加 Telegram allowFrom/group allowlist
- 增加 mention gating 与 owner-only 选项
- 补充审计字段（provider/chatId/userId）

验收标准：

- 非 allowlist 用户请求被拒
- 群里未 mention 不触发执行
- 审计日志可追溯到 Telegram 用户

## Batch-TG3（P1）稳定性增强

- 文本分片策略（长度限制）
- 网络重试与退避
- polling/webhook 可切换

验收标准：

- 长文本可完整返回（不截断）
- 网络抖动下自动恢复
- 切换 polling/webhook 不改业务层

## Batch-TG4（P1）灰度与回滚

- 支持 iMessage + Telegram 双通道并行
- 增加按 workspace 的通道开关
- 完整回滚脚本（5 分钟内切回）

验收标准：

- 双通道同时可用，互不干扰
- 主切 Telegram 后 24h 无 P0 故障
- 回滚演练一次成功

---

## 6) 测试矩阵

- 功能：DM、群聊、mention、附件、slash 命令
- 安全：allowlist、owner-only、未授权用户
- 稳定：超时重试、长消息分片、并发消息
- 回归：`npm run test:all` + Telegram smoke

建议新增：

- `scripts/telegram/smoke-telegram.sh`
- `test/channels.telegram.adapter.test.ts`

---

## 7) 上线策略

1. 开发环境先启 `polling`，完成 TG1+TG2。
2. 预发环境灰度 1 个群 + 1 个私聊（24 小时）。
3. 生产切换：Telegram 主通道，iMessage 保底通道。
4. 观察窗口：48 小时重点看错误率、超时率、消息延迟。

---

## 8) 回滚策略

- 保留 iMessage 入口配置，不删除。
- 发现 P0 故障时：
  - 关闭 `channels.telegram.enabled`
  - 恢复 iMessage 入口
  - 保留 Telegram 审计数据，便于复盘

目标：5 分钟内恢复服务。

---

## 9) 风险与对策

- 风险：Telegram 限流或网络抖动
  - 对策：分片 + retry + backoff
- 风险：群误触发
  - 对策：默认 requireMention + allowlist
- 风险：通道切换期间行为不一致
  - 对策：适配层契约测试（inbound/outbound contract）

---

## 10) 里程碑与工期

- TG1：0.5 天
- TG2：0.5 天
- TG3：0.5 天
- TG4：0.5 天

总计：约 2 天（含灰度前准备）。

