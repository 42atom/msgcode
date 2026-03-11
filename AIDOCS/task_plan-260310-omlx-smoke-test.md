# Task Plan: omlx 本地后端实机验证

## Goal
验证用户本机已安装的 `omlx` 是否可正常提供服务，并测试其作为 `msgcode` 本地后端候选时的最小可用链路。

## Phases
- [x] Phase 1: 确认服务与模型状态
- [x] Phase 2: 跑基础接口与推理冒烟
- [x] Phase 3: 对照 msgcode 关键链路判断可替代性
- [x] Phase 4: 形成测试结论并交付

## Key Questions
1. `omlx` 服务是否真的启动并可访问？
2. 当前有哪些已发现/已加载模型？
3. 聊天、视觉、embedding 哪些已经可用？
4. 对 `msgcode` 来说是“可试接”还是“暂不具备条件”？

## Decisions Made
- 先做最小链路测试，不先改 `msgcode` 代码。
- 先看服务与模型，再跑 chat/vision/embedding；避免无模型时浪费时间。
- 视觉链不以“接口接收成功”为准，而以可判定样本是否答对为准。
- 同步验证模型卸载后的自动重载，判断是否必须保留显式 load 控制面。

## Errors Encountered
- 上一轮在用户中断前，`127.0.0.1:8000` 尚未监听。
- `omlx` 启用了 API key 鉴权，`/v1/*` 未带鉴权时会返回 `401 API key required`。
- 当前已安装主模型 `current-glm47` 不是 embedding model，`/v1/embeddings` 返回 `400`。
- 当前视觉测试样本答错，不能把这套安装视为可靠视觉后端。

## Status
**Completed** - 已完成本机 `omlx` 冒烟验证，结论已写入 `aidocs/notes/research-260310-omlx-local-smoke-test.md`。
