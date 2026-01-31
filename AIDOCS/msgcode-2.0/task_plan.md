# Task Plan: msgcode 2.0（新版本计划与任务拆分）

## Goal
把 msgcode 升级为“可长期运维”的本地 iMessage Bot 平台：核心链路去除 DB 写依赖，群聊/收消息优先走 `imsg rpc`，并把 `imsg` 的供应链风险压到可控（源码构建+固定版本）。

## Phases
- [x] Phase 0: Version scope & success criteria
- [x] Phase 1: imsg 供应链方案（开源核验 + 源码构建 + 固定版本）
- [ ] Phase 2: iMessage Provider 改造（rpc send + watch）
- [ ] Phase 3: 收消息链路去 DB 写（lastSeen 游标替代 unreadOnly/markAsRead）
- [ ] Phase 4: 发送链路统一与降级策略（DM/群聊同构）
- [ ] Phase 5: 可观测性与自愈（probe/health/日志结构化）
- [ ] Phase 6: 测试与回归（无真账号也能测的模拟层）
- [ ] Phase 7: 打包与运行方式（launchd/配置/升级）
- [ ] Phase 8: 发布（RC → 2.0）

## Key Questions
1. msgcode 2.0 的“必须做到”是什么：稳定性、可运维、还是功能扩展？
2. 是否接受把 iMessage I/O 统一迁移到 `imsg rpc`（SDK 只做 fallback）？
3. 是否需要支持多账号/远端 Mac（SSH wrapper）作为 2.0 范围？

## Deliverables (files)
- `AIDOCS/msgcode-2.0/msgcode_2.0_release_plan.md`
- `AIDOCS/msgcode-2.0/backlog/README.md`
- `AIDOCS/msgcode-2.0/backlog/E01_supply-chain_imsg.md`
- `AIDOCS/msgcode-2.0/backlog/E02_imessage_provider_rpc.md`
- `AIDOCS/msgcode-2.0/backlog/E03_receive_pipeline_lastseen.md`
- `AIDOCS/msgcode-2.0/backlog/E04_send_pipeline_unification.md`
- `AIDOCS/msgcode-2.0/backlog/E05_observability_probe_health.md`
- `AIDOCS/msgcode-2.0/backlog/E06_tests_simulation.md`
- `AIDOCS/msgcode-2.0/backlog/E07_packaging_launchd.md`
- `AIDOCS/msgcode-2.0/feature_spec_control_plane_v1.md`
- `AIDOCS/msgcode-2.0/config_spec_v1.md`
- `AIDOCS/msgcode-2.0/epics/E08_control_plane_newchat.md`
- `AIDOCS/msgcode-2.0/epics/E09_public_artifacts_and_tunnel.md`
- `AIDOCS/msgcode-2.0/epics/E10_scheduler_jobs_push.md`
- `AIDOCS/msgcode-2.0/epics/E11_capability_api_skills.md`
- `AIDOCS/msgcode-2.0/epics/E13_model_switching.md`
- `AIDOCS/msgcode-2.0/epics/E14_lastseen_cursor.md`
- `AIDOCS/msgcode-2.0/epics/E15_probe_status.md`
- `AIDOCS/msgcode-2.0/epics/E16_code_health_and_boundary.md`
- `AIDOCS/msgcode-2.0/epics/E17_log_privacy_and_shell_safety.md`

## Decisions Made
- 2.0 核心风险优先级：供应链（高权限依赖） > 收消息可靠性（去 DB 写） > 群聊发送稳定性（去 AppleScript 主路径）。
- 范围选择：采用 **方案 B（高收益，`imsg rpc` 作为主 provider）**。
- 发布策略：**不使用 Cloudflare Tunnel**；发布通道改为 **Pinme（静态网页）+ OneDrive（文件/成果）**，并做成可配置插件能力。
- 内容处理边界：**msgcode 只做“全面转发/能力管理”（I/O、落盘、发布、权限、审计），不做 ASR/TTS/内容理解**；内容处理由 agent 的 skill 负责。
- 主链路约束：**不保留 iMessage SDK / AppleScript fallback**；收/发统一走 `imsg rpc`。

## Status
**Currently in Phase 2** - 开始 E02（`imsg rpc` provider：watch + send），逐步替换现有 SDK watcher 主链路。
