# P5.6.2-P0-SOUL：从 873e1fc 最小摘取 SOUL 过滤修复

## 背景

P5.6.2 任务期间发现 SOUL 过滤存在误判风险：
- 原始修复在提交 `873e1fc`（1495 行混合改动）
- 包含：pi-assembler.ts, soul/loader.ts, soul/active.ts, soul/types.ts 等
- 整包 cherry-pick 风险过高

## 目标

从 `873e1fc` 中最小摘取 SOUL 过滤相关代码，避免引入：
- PI 命令路径（已有 /reload）
- soul 加载器（当前不需要运行时加载）
- 新文件（保持当前目录结构）

## 禁止事项

- 禁止创建 src/soul/ 目录
- 禁止创建 src/skills/pi-assembler.ts
- 禁止整包 cherry-pick 873e1fc

## 实施思路

1. 分析 873e1fc 中 SOUL 过滤相关代码（renderSoulContent）
2. 仅提取该函数到现有模块（如 config/souls.ts）
3. 确保不改变任何导出接口

## 验收

- [ ] src/soul/ 目录不存在
- [ ] src/skills/pi-assembler.ts 不存在
- [ ] tsc --noEmit 通过
- [ ] npm test 0 fail

## 延后原因

整包 cherry-pick 风险过高（1495 行混合改动），需最小摘取方案。

## 回滚

```bash
git checkout p5.6.2-checkpoint
```
