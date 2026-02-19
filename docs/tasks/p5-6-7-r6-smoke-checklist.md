# P5.6.7 R6 集成冒烟清单

## 工作区

| 工作区 | 路径 |
|--------|------|
| medicpass | /Users/admin/msgcode-workspaces/medicpass |
| charai | /Users/admin/msgcode-workspaces/charai |
| game01 | /Users/admin/msgcode-workspaces/game01 |

## 静态验证结果 ✅

执行时间: 2026-02-19T05:49:22.116Z

### medicpass
- 配置文件: ✅
- 全局 SOUL 目录: ✅
- 工作区 SOUL.md: ✅
- memory 目录: ✅
- **状态: ✅ PASS**

### charai
- 配置文件: ✅
- 全局 SOUL 目录: ✅
- 工作区 SOUL.md: ✅
- memory 目录: ✅
- **状态: ✅ PASS**

### game01
- 配置文件: ✅
- 全局 SOUL 目录: ✅
- 工作区 SOUL.md: 不存在（可选）
- memory 目录: 不存在（可选）
- **状态: ✅ PASS**

## 代码语义验证 ✅

| 验证点 | 文件 | 状态 |
|--------|------|------|
| direct 路径调用 runLmStudioToolLoop | src/handlers.ts:627 | ✅ |
| /clear 调用 clearSessionArtifacts | src/runtime/session-orchestrator.ts | ✅ |
| /reload 输出 SOUL 字段 | src/routes/cmd-schedule.ts:218-219 | ✅ |
| runSkill 是单一执行入口 | src/skills/auto.ts:88 | ✅ |
| /clear 不清 memory（无 clearMemory） | src/session-artifacts.ts | ✅ |
| 自然语言与 /skill run 同执行器 | src/lmstudio.ts:1193-1194 | ✅ |

## 运行时冒烟（需手工执行）

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

## 硬验收门 ✅

- [x] `npx tsc --noEmit` ✅
- [x] `npm test` 0 fail ✅ (469 tests)
- [x] `npm run docs:check` ✅
- [x] 3 工作区静态冒烟全部 ✅

## 签收状态

**静态验证: ✅ 完成**
**运行时冒烟: ⏳ 待手工执行**

运行时冒烟需要通过 iMessage 实际发送命令验证。
