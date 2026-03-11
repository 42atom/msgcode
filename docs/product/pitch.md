# msgcode Pitch

> Personal Agent Infrastructure, Community Built
>
> 个人节点化智能基础设施，共建型社区平台

## 1. Problem

当前 AI 产品的主流范式仍然是“集中平台 + 被动使用”：
- 计算和数据集中在云端
- 用户是功能调用者，不是系统拥有者
- 能力沉淀难复用，社区贡献难长期累积

结果是：
- 个人数据主权弱
- 工作流资产化困难
- 社区创造力被“平台功能边界”限制

## 2. Thesis

msgcode 的核心主张：

> 每个人先拥有自己的智能节点，再把节点接入社区共建网络。

一句话：

> Build your own agent home, then build the network together.

## 3. Product Model

msgcode 采用双执行线：
- `Agent 线`：本地中枢（记忆、SOUL、skills、工具编排）
- `Tmux 线`：复杂任务执行通道（codex / claude-code）

设计原则：
- 业务语义在 Agent 线
- 重型执行在 Tmux 线
- 两线隔离，按任务切换

这让“个人可控”和“工程可执行”同时成立。

## 4. Community-First Value

msgcode 不是“一个人玩得转”的工具，而是“多人越用越强”的底座：
- 用户共享可复用 skill 与模板
- 创作者沉淀场景化工作流
- 开发者贡献模块与连接器
- 维护者定义规范、验收与兼容边界

目标是把个人经验变成社区资产，而不是一次性聊天记录。

## 5. Platform Positioning

msgcode 定位：

> Community-oriented Personal Agent Infrastructure

它更像 Runtime + Orchestration + Community Protocol，而不是聊天应用。

边界与特性：
- 本地优先（隐私、可控、可审计）
- 可组合（模型、技能、执行臂、策略可替换）
- 可协作（模板、实践、规范可共享）
- 可持续（会话、记忆、路由、调度可长期运行）

## 6. Why macOS First

现阶段以 macOS 首发是工程选择：
- 本地自动化能力成熟
- iMessage 场景链路短，验证快
- 单机可快速形成“可运行节点”

这不是平台终局，只是最短落地路径。

## 7. Community Flywheel

- 节点增长：更多用户跑起本地节点
- 资产增长：更多 skills / templates / playbooks 被沉淀
- 协作增长：更多复用、fork、改进和共创
- 质量增长：规范、评审、回归体系持续完善

飞轮逻辑：

> 用户越多，资产越多；资产越多，节点越易启动；节点越易启动，社区越快增长。

## 8. How People Join

- Users: 绑定工作区，复用模板，反馈场景问题
- Creators: 打包并发布高价值工作流模板
- Developers: 贡献工具连接器、provider 适配、调度模块
- Maintainers: 维护协议、文档、验收与稳定性门禁

## 9. Roadmap

- Phase 1: Runtime stability（节点可稳态运行）
- Phase 2: Skill/module standardization（社区贡献可复用）
- Phase 3: Template marketplace prototype（模板共享闭环）
- Phase 4: SDK & Runtime API（第三方扩展友好）
- Phase 5: Multi-node interconnect（节点间协作）
- Phase 6: Personal Agent Network（社区化智能网络）

## 10. Closing Statement

msgcode 的目标不是做一个“更聪明的聊天入口”，
而是让每个人都能拥有、运行并共建自己的智能系统。

一台设备，是一个节点。
一群人，可以共同建设一个智能生态。
