# Review Findings: iMessage Sunset & Feishu-only Transition

**P1: Legacy Naming disguising true channel-neutrality**
- `src/commands.ts:20-21`
  - [OutboundSendParams](file:///Users/admin/GitProjects/msgcode/src/commands.ts#20-25) 使用了 `chat_guid` 作为标示，这是 iMessage 特化的遗留命名语义（全局唯一的内部 ID 口径）。既然已经收口为 `feishu-only` 与未来的 channel-neutral 边界，这里建议就地重构为统一的 `chatId` 避免将特定的底层名词强加于抽象主链上。

**P1: Archive 真相源丢失风险**
- `docs/CHANGELOG.md:6` & `docs/design/plan-260312-feishu-only-channel-simplification-and-imsg-sunset.md:121` 与 `.gitignore:38`
  - 文档宣称 `src/imsg/` 迁入了 `.trash/2026-03-12-imsg-sunset/`。但因为 `.trash/` 属于 `.gitignore` 规则，这实际上等于在 Git 脱轨前直接做了一次硬删除，不仅丧失了 `imsg` 组件随岁月更迭的上下文历史，也打破了退役组件可查阅的「版本化 Archive」设定。建议改迁至 `docs/archive/retired-imsg-runtime/`。

**P2: Legacy State 残影暴露于现役契约**
- `src/jobs/types.ts:266`
  - 仍保留了 `| "IMSG_SEND_FAILED"` 状态类型，后续若接入更多 Channel，`IMSG` 前缀明显已不再适宜。建议做收口（如 `DELIVERY_FAILED` / `CHANNEL_SEND_FAILED`）。

**P3: 技术参考资料产生维护现役幻觉**
- `AIDOCS/refs/imessage-kit/深入 iMessage 底层：一个 Agent 是如何诞生的.md`
  - 这种高能度的原作者沉淀极易误导后来的提示词（或开发者）将其视为当前能力支柱。既然进入 Sunset 轨道，这部分文档应做归档标记。

**补充检查结论 (Pass)**:
- Truth Source (`issues`, `CHANGELOG`, `design plan`) 一致性完好，逻辑已闭环。
- CLI 主链路（`transports.ts`, `config.ts`, `index.ts`）已确实截断任何通过猜测式降级回到 fallback-imsg 的投机。
- 端到端测试隔离了宿主机环境 (`MSGCODE_TRANSPORTS` env 污染)，真实测试了 CLI 断层拒绝和进程起步。且 rg 扫库无活跃 `IMSG_PATH` 执行逻辑散落。
