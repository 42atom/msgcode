# 任务单：/help 命令单一注册表收口方案

Issue: 0049  
Plan: aidocs/plan/plan-260309-help-command-single-source.md

## 任务一句话

把群聊 `/help` 相关代码收口为“一个 slash command registry + 多处投影”，先出方案，再决定是否实现。

## 本轮范围

- 现状盘点
- 方案对比
- 推荐决策
- 文件路径与测试口径

## 非范围

- 不直接改命令行为
- 不把 CLI `help-docs` 与群聊 `/help` 强行合并
- 不引入完整 DSL 式命令编排层

## 硬验收

1. 方案文档明确单一真相源位置
2. 方案文档包含回滚策略
3. 方案文档包含最小代码示例

## 交付

- `aidocs/plan/plan-260309-help-command-single-source.md`
