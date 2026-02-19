# P5.6.8-R4d：三工作区运行时冒烟清单

## 工作区

| 工作区 | 路径 |
|--------|------|
| medicpass | /Users/admin/msgcode-workspaces/medicpass |
| charai | /Users/admin/msgcode-workspaces/charai |
| game01 | /Users/admin/msgcode-workspaces/game01 |

## 执行时间

开始时间：___________
结束时间：___________

## 冒烟清单

### 1. /bind 验证

**命令**：`/bind <workspace>`

**预期**：
- 返回配置摘要
- 包含 workspace 路径
- 包含 pi.enabled 状态

**证据记录**：
```
medicpass: [粘贴输出]
charai: [粘贴输出]
game01: [粘贴输出]
```

---

### 2. /reload 验证

**命令**：`/reload`

**预期**：
- SOUL: workspace=已发现 (<workspace>/.msgcode/SOUL.md)
- SOUL Entries: N (active=xxx)
- Schedules: N 个
- Skills: 已配置/未配置

**证据记录**：
```
medicpass: [粘贴输出]
charai: [粘贴输出]
game01: [粘贴输出]
```

**关键字段验证**：
- [ ] SOUL 路径显示为 `.msgcode/SOUL.md`
- [ ] SOUL Entries 数量与实际文件一致

---

### 3. pi off 验证

**命令**：在配置中设置 `"pi.enabled": false`，然后自然语言对话

**预期**：
- LLM 不调用工具（toolCallCount=0）
- 返回普通对话响应
- 日志显示 `toolCallCount: 0`

**证据记录**：
```
medicpass:
  用户输入: "你好"
  LLM 响应: [粘贴]
  日志字段: toolCallCount=___, toolName=___

charai:
  用户输入: "你好"
  LLM 响应: [粘贴]
  日志字段: toolCallCount=___, toolName=___

game01:
  用户输入: "你好"
  LLM 响应: [粘贴]
  日志字段: toolCallCount=___, toolName=___
```

---

### 4. pi on 验证

**命令**：在配置中设置 `"pi.enabled": true`，然后自然语言触发工具

**预期**：
- LLM 调用工具（toolCallCount=1）
- toolName 为四工具之一（read_file/write_file/edit_file/bash）
- 工具执行成功

**证据记录**：
```
medicpass:
  用户输入: "读取 package.json"
  LLM 响应: [粘贴]
  日志字段: toolCallCount=___, toolName=___

charai:
  用户输入: "读取 package.json"
  LLM 响应: [粘贴]
  日志字段: toolCallCount=___, toolName=___

game01:
  用户输入: "读取 package.json"
  LLM 响应: [粘贴]
  日志字段: toolCallCount=___, toolName=___
```

---

### 5. 记忆触发验证

**命令**：在配置中设置 `"memory.inject.enabled": true`，然后触发记忆关键词

**预期**：
- 日志显示 memory 注入字段
- injected/hitCount/injectedChars 有值
- usedPaths 显示记忆文件路径

**证据记录**：
```
medicpass:
  用户输入: "记得我们之前讨论的内容吗"
  LLM 响应: [粘贴]
  日志字段: injected=___, hitCount=___, injectedChars=___, usedPaths=___

charai:
  用户输入: "记得我们之前讨论的内容吗"
  LLM 响应: [粘贴]
  日志字段: injected=___, hitCount=___, injectedChars=___, usedPaths=___

game01:
  用户输入: "记得我们之前讨论的内容吗"
  LLM 响应: [粘贴]
  日志字段: injected=___, hitCount=___, injectedChars=___, usedPaths=___
```

---

### 6. /clear 验证

**命令**：`/clear`

**预期**：
- 清理 window + summary
- 不清理 memory
- 日志确认清理成功

**证据记录**：
```
medicpass: [粘贴输出]
charai: [粘贴输出]
game01: [粘贴输出]
```

**验证点**：
- [ ] window 已清空
- [ ] summary 已清空
- [ ] memory 仍然存在

---

### 7. 复测记忆注入

**命令**：再次触发记忆关键词

**预期**：
- 记忆仍然可注入（证明 /clear 未清 memory）
- 注入字段正常

**证据记录**：
```
medicpass:
  用户输入: "记得我们之前讨论的内容吗"
  LLM 响应: [粘贴]
  日志字段: injected=___, hitCount=___

charai:
  用户输入: "记得我们之前讨论的内容吗"
  LLM 响应: [粘贴]
  日志字段: injected=___, hitCount=___

game01:
  用户输入: "记得我们之前讨论的内容吗"
  LLM 响应: [粘贴]
  日志字段: injected=___, hitCount=___
```

---

## 硬验收门

### 静态验证

- [ ] `npx tsc --noEmit` ✅
- [ ] `npm test` (526 pass, 4 fail - imessage-kit) ✅
- [ ] `node scripts/test-gate.js` ✅
- [ ] `npm run docs:check` ✅

### 动态验证（三工作区）

- [ ] medicpass 全部通过
- [ ] charai 全部通过
- [ ] game01 全部通过

### 证据完整性

- [ ] toolCallCount/toolName 字段完整
- [ ] SOUL source/path 字段正确
- [ ] memory 注入字段可观测

---

## 签收单

**冒烟执行人**：___________
**执行日期**：___________
**通过状态**：___________

**备注**：
```
[填写任何发现的问题或特殊情况]
```

---

## 回滚方案

如冒烟失败：
1. 保留失败证据（截图/日志）
2. 创建 issue 记录问题
3. 回退到上一个稳定提交
4. 修复后重新冒烟
