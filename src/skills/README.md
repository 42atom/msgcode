# Skills

## 目录结构
```
src/skills/
  README.md               # 本目录说明
  auto.ts                 # 自动触发与最小技能执行
```

## 职责边界
- `auto.ts`：负责自然语言触发与最小技能执行（当前仅 system-info）。
- 本目录只做“触发与执行”，不做权限/配置编排。

## 架构决策
- 先落最小可用路径：只实现 `system-info`，避免引入复杂编排。
- 自动触发与显式调试入口共用同一执行函数，避免分叉逻辑。

## 开发规范
- 新增技能先扩展 `SkillId` 与 `normalizeSkillId`，再补 `detectAutoSkill`。
- 输出保持纯文本，避免引入协议化提示。

## 变更日志
- 2026-02-18：新增 auto skill 最小骨架与 system-info。
