# Task Plan: omlx 是否可取代 LM Studio

## Goal
判断 `GithubDown/omlx` 是否能作为 `msgcode` 的本地模型后端取代 `LM Studio`，并明确是“零代码替代”、“部分替代”还是“需要适配后可替代”。

## Phases
- [x] Phase 1: 确认本地仓库位置与版本
- [x] Phase 2: 阅读 README、服务入口与 API 面
- [x] Phase 3: 对照 `msgcode` 当前对 LM Studio 的依赖点
- [x] Phase 4: 形成结论并落研究文档

## Key Questions
1. `omlx` 是否覆盖 `msgcode` 当前需要的聊天、工具调用、视觉、embedding 能力？
2. `omlx` 是否兼容 `msgcode` 现有的 LM Studio 专属 API 假设？
3. 如果不能直接替代，最小适配点在哪里？

## Decisions Made
- 先按“后端契约替代”看，不按“产品体验谁更强”看。
- 把“能不能取代”拆成四档：基础聊天、视觉/embedding、自动恢复、平台/模型格式。

## Errors Encountered
- 无

## Status
**Completed** - 已完成代码级比对与研究结论落盘。
