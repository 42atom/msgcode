# P5.6.7 R6 集成冒烟清单

## 工作区

| 工作区 | 路径 |
|--------|------|
| medicpass | /Users/admin/msgcode-workspaces/medicpass |
| charai | /Users/admin/msgcode-workspaces/charai |
| game01 | /Users/admin/msgcode-workspaces/game01 |

## 冒烟步骤

### 1. /bind 验证
- [ ] 绑定成功，返回配置摘要

### 2. /reload 验证
- [ ] 输出包含 `SOUL: workspace=`
- [ ] 输出包含 `SOUL Entries:`

### 3. 自然语言触发 tool/skill
- [ ] direct 路径：日志包含 SOUL/记忆/tool loop 语义
- [ ] 触发成功，返回预期结果

### 4. /skill run 对照
- [ ] 与自然语言触发使用同一执行器 `runSkill()`
- [ ] 结果一致

### 5. /clear 验证
- [ ] 清理 window + summary
- [ ] **不清理** memory

### 6. tmux 路径验证（如适用）
- [ ] 仅忠实转发，无 SOUL/记忆注入

## 结果记录

### medicpass
- 状态: [ ] PASS / [ ] FAIL
- 关键日志:
- 失败点（如有）:

### charai
- 状态: [ ] PASS / [ ] FAIL
- 关键日志:
- 失败点（如有）:

### game01
- 状态: [ ] PASS / [ ] FAIL
- 关键日志:
- 失败点（如有）:

## 硬验收门

- [ ] `npx tsc --noEmit` ✅
- [ ] `npm test` 0 fail ✅
- [ ] `npm run docs:check` ✅
- [ ] 3 工作区冒烟全部 ✅
