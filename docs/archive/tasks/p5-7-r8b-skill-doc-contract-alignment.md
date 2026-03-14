# 任务单：P5.7-R8b（SKILL.md 与真实能力合同对齐）

优先级：P1（R8 完成后收口）

## 目标（冻结）

1. 对齐 `AIDOCS/skills/*/SKILL.md` 与当前真实 CLI 能力。
2. 清除过期/不存在命令，禁止文档层“幻想能力”。
3. 建立一致性检查：`SKILL.md` 示例命令必须可在 `help-docs --json` 找到合同。

## 背景（问题本质）

Skill 文档是模型执行前的“能力说明层”。  
如果文档与真实命令不一致，模型会稳定地产生错误调用，直接拖垮运行稳定性。

## 范围

- `/Users/admin/GitProjects/msgcode/AIDOCS/skills/README.md`
- `/Users/admin/GitProjects/msgcode/AIDOCS/skills/*/SKILL.md`
- `/Users/admin/GitProjects/msgcode/scripts/*`（如新增一致性检查脚本）
- `/Users/admin/GitProjects/msgcode/test/*skill*`（如新增校验测试）
- `/Users/admin/GitProjects/msgcode/docs/tasks/README.md`

## 非范围

1. 不新增 CLI 能力。
2. 不改运行时执行主链。
3. 不在本单引入新的 skill 调度机制。

## 执行步骤（每步一提交）

### R8b-1：能力清单拉齐

提交建议：`docs(p5.7-r8b): align skills docs with live cli contracts`

1. 逐个校对 `SKILL.md` 命令示例。
2. 不存在的命令直接移除或替换为真实命令。

### R8b-2：一致性检查器

提交建议：`test(p5.7-r8b): add skill-doc-to-contract consistency checks`

1. 增加脚本/测试：提取 `SKILL.md` 命令行。
2. 对照 `msgcode help-docs --json` 合同，发现未实现命令则失败。

## 硬验收（必须全过）

1. `npx tsc --noEmit`
2. `npm test`（0 fail）
3. `npm run docs:check`
4. `SKILL.md` 示例命令全部可在 `help-docs --json` 查到
5. 无新增 `.only/.skip`

## 验收回传模板（固定口径）

```md
# P5.7-R8b 验收报告（SKILL.md 合同对齐）

## 提交
- <sha> <message>

## Gate
- npx tsc --noEmit:
- npm test:
- npm run docs:check:

## 对齐证据
- 已清理过期命令:
- SKILL.md 命令合同一致性检查结果:

## 风险与遗留
- 风险:
- 遗留:
```
