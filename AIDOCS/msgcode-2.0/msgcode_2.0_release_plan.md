# msgcode 2.0：版本计划（Draft）

## 版本目标（2.0 的一句话）
让 msgcode 从“能跑的脚本集合”进化成“可长期运维的本地 iMessage Bot 平台”：供应链可控、收发稳定、状态自洽。

## 两个范围选项（你选一个）

### 方案 A（低风险，先止血）
- 不引入 `imsg rpc`（或只用于群聊发送），优先把收消息链路从“unreadOnly + 写 DB”迁移到“lastSeen 游标”。
- 触发源收敛：SDK watcher 为主 + 低频 poll 为保底；`fs.watch(chat.db)` 默认关闭。
- 群聊发送暂留 AppleScript，但把接口统一并把重试/超时/日志集中化。

### 方案 B（高收益，偏产品化）
- `imsg rpc` 成为主 provider：
  - 收：`watch.subscribe` 推送
  - 发：`send`（DM/群聊同构目标）
- 不保留 SDK/AppleScript fallback（2.0 直接收口到 imsg RPC）。
- 目标：主链路不写 `chat.db`，不依赖 GUI Automation 权限。

**当前选择：方案 B（2026-01-28）**

## 成功标准（验收）
- 24h 连续运行：无“停摆后自愈”这种强依赖；重复/漏收概率显著下降（以日志指标证明）。
- 不写 `chat.db` 也能稳定收消息（核心转折点）。
- 群聊发送成功率可观测：可输出 messageId/guid 或可追踪的发送结果；失败有明确错误码与重试策略。
- 供应链可控：`imsg` 产物来自固定 tag/commit 的源码构建，并有产物 hash/签名记录。

## 里程碑（建议节奏）
- M0（1-2 天）：冻结范围（选 A 或 B），定成功标准与回滚策略
- M1（2-4 天）：E01 供应链（源码构建 + 固定版本 + 验证）
- M2（3-6 天）：E03 收消息 lastSeen（去 DB 写）
- M3（2-4 天）：E04 发送统一（把分支封装起来）
- M4（2-4 天）：E05 可观测性（probe/health/结构化日志）
- M5（2-5 天）：E06 测试/模拟（无真账号可回归）
- M6（1-3 天）：E07 打包运行（launchd + 配置升级）

## Backlog（按 Epic）
详见：`AIDOCS/msgcode-2.0/backlog/README.md:1`

## 风险与对策（最重要的 3 个）
1. 高权限依赖（Messages DB + Automation）→ 用专用 macOS 用户/专用 Apple ID 隔离；provider 失败时给出明确 probe 与指引。
2. 多触发源导致重复/乱序 → 只保留 1 主 + 1 保底；并引入“单一消息游标”。
3. 供应链（release zip）→ 源码构建 + 固定 tag/commit + 产物校验记录。
