# Epics（msgcode 2.0）

> 每个 Epic 都是“可验收的故事线”：目标明确、边界清晰、测试可跑。

## 清单
- E08：控制面（群内 `/bind` 绑定工作目录）
- E12：聊天进程管理（`/chatlist` + `/help`）
- E14：收消息游标（`lastSeenRowId`），彻底去 DB 写依赖
- E15：可观测性与探针（`msgcode probe/status` + 结构化日志）

## 约束（2.0 总原则）
- iMessage I/O 只走 `imsg rpc`（不使用 iMessage SDK / AppleScript fallback）。
- msgcode 只做“转发/落盘/路由/权限/发布接口”，不做内容理解/ASR/TTS。
- `WORKSPACE_ROOT` 是唯一根目录：所有 workspace 都必须是其子目录（相对路径绑定）。

