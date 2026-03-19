# COGNITION（Agent 人类认知文件表）

## 结论

- Agent 不是靠一段黑盒 prompt “认识”机构。
- msgcode 默认把人类可读的认知面摊开成文件。
- 这张表只收 **面向人类** 的文件真相源与派生视图。

不放进来：

- `.json / .jsonl / .ndjson`
- `dispatch / subagents / sessions raw log`
- 其他运行时机器协议面

这些内容另看 `docs/protocol/*`。

## 文件表

| 文件面 | 具体文件名 / 文件模式 | 作用 | 真相级别 | 生命周期 |
|---|---|---|---|---|
| 灵魂 | `~/.config/msgcode/souls/default/SOUL.md` `/<workspace>/.msgcode/SOUL.md` | 定义人格、风格、边界 | 认知真相源 | 长期 |
| 长期记忆 | `/<workspace>/memory/YYYY-MM-DD.md` | 记录稳定事实、偏好、经验 | 记忆真相源 | 长期 |
| 会话摘要 | `/<workspace>/.msgcode/sessions/<chatId>/summary.md` | 服务压缩与恢复阅读 | 派生视图 | 可重建 |
| 原始请求 inbox | `/<workspace>/.msgcode/inbox/rq0001.new.<transport>.<slug>.md` `/<workspace>/.msgcode/inbox/rq0001.triaged.<transport>.<slug>.md` | 记录新请求和分拣状态 | I/O 真相源 | 短中期 |
| heartbeat 草稿 | `/<workspace>/.msgcode/HEARTBEAT.md` | 记录巡检提示、checklist、notes | 草稿面 | 可覆盖 |
| 每日日记 | `/<workspace>/AIDOCS/reports/daily/YYYY-MM-DD.md` | 记录当天完成、阻塞、下一步 | reflection 真相 | 每日追加 |
| 记忆候选 | `/<workspace>/.msgcode/reflection/memory-candidates/memory-<category>-<YYYYMMDD>-<seq>.md` | 记录待审核的长期经验 | reflection 真相 | 阶段性 |
| skill 候选 | `/<workspace>/.msgcode/reflection/skill-candidates/skill-<category>-<YYYYMMDD>-<seq>.md` | 记录待沉淀的 skill/workflow | reflection 真相 | 阶段性 |
| 任务状态 | `/issues/tkNNNN.<state>.<board>[.prio].<slug>.md` | 记录任务状态、责任、验收口径 | 任务真相源 | 生命周期完整 |
| 交付与证据 | `/AIDOCS/reports/*` `/AIDOCS/artifacts/*` | 放报告、素材、补充证据 | 证据面 | 按需保留 |

## 一句话收口

- `SOUL + memory + summary` 负责“认识机构”
- `inbox + issues` 负责“接活并推进”
- `reflection + AIDOCS` 负责“回收经验和保留证据”
