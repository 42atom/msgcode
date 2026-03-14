# 任务单：P5.7-R3a（runSkill 残留硬清理）

优先级：P0（技术债插单，R4 前必须清零）

## 目标（冻结）

1. 清除 `runSkill/runAutoSkill/skill-orchestrator` 在运行时主链的残留符号与死代码。
2. 保持当前 CLI-First 主路径不变（只走 `help-docs --json -> CLI 命令`）。
3. 建立静态锁：禁止 `runSkill` 残留再次回流到可执行路径。

## 背景（问题本质）

`run_skill` 工具已退场，但 `src/skills/*` 与 `src/runtime/skill-orchestrator.ts` 仍有历史残留命名。  
这些残留会误导实现者，造成“存在第二执行链”的认知偏差。

## 范围

- `/Users/admin/GitProjects/msgcode/src/skills/auto.ts`
- `/Users/admin/GitProjects/msgcode/src/skills/index.ts`
- `/Users/admin/GitProjects/msgcode/src/skills/registry.ts`
- `/Users/admin/GitProjects/msgcode/src/runtime/skill-orchestrator.ts`
- `/Users/admin/GitProjects/msgcode/test/*r3e*`
- `/Users/admin/GitProjects/msgcode/test/*skills*`
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`

## 非范围

1. 不改 `AIDOCS/skills/*` 文档内容（由 R8b 统一对齐）。
2. 不新增任何能力命令。
3. 不改 memory/thread/file 等已上线 CLI 行为。

## 执行步骤（每步一提交）

### R3a-1：主链清零

提交建议：`refactor(p5.7-r3a): remove legacy runSkill runtime residues`

1. 删除或下线 `skill-orchestrator` 主链入口。
2. `src/skills/index.ts` 移除 `runSkill/runAutoSkill` 暴露。
3. `src/skills/registry.ts` 清理占位执行函数，保留纯索引能力（若仍需要）。

### R3a-2：测试与静态锁

提交建议：`test(p5.7-r3a): add runskill-residue hard-cut locks`

1. 静态扫描断言：`src/` 可执行路径不允许 `runSkill` 调用链。
2. 保留必要退役注释与历史测试口径，不要求文字 0 命中。

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `rg -n "\brunSkill\(|\brunAutoSkill\(|skill-orchestrator" src` 不应命中可执行路径
5. 无新增 `.only/.skip`

## 验收回传模板（固定口径）

```md
# P5.7-R3a 验收报告（runSkill 残留硬清理）

## 提交
- <sha> <message>

## Gate
- npx tsc --noEmit:
- npm test:
- npm run docs:check:

## 清理证据
- runSkill 残留扫描:
- skill-orchestrator 主链状态:

## 风险与遗留
- 风险:
- 遗留:
```
