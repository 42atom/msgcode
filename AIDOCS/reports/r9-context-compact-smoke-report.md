# P5.7-R9-T2 真实长会话冒烟测试报告

生成时间: 2026-02-22T13:59:45.147Z

## 测试汇总

- 通过: 8/8
- 状态: ✅ ALL PASS

## 测试详情

### ✅ PASS 预算感知模块可导入

**证据:**
```json
{
  "contextWindowTokens": 16384,
  "reservedOutputTokens": 2048,
  "inputBudget": 14336
}
```

### ✅ PASS 会话窗口模块可导入

**证据:**
```json
函数存在: loadWindow, appendWindow, rewriteWindow, trimWindowWithResult
```

### ✅ PASS 摘要模块可导入

**证据:**
```json
函数存在: loadSummary, saveSummary, extractSummary, formatSummaryAsContext
```

### ✅ PASS 窗口写入和读取

**证据:**
```json
{
  "messageCount": 3,
  "roles": [
    "user",
    "assistant",
    "user"
  ]
}
```

### ✅ PASS 预算计算

**证据:**
```json
{
  "usedTokens": 13,
  "budget": 14336,
  "usagePct": 0,
  "isWithinBudget": true
}
```

### ✅ PASS 窗口裁剪

**证据:**
```json
{
  "originalCount": 20,
  "keptCount": 10,
  "trimmedCount": 10,
  "wasTrimmed": true
}
```

### ✅ PASS 摘要提取

**证据:**
```json
{
  "goals": 1,
  "constraints": 0,
  "decisions": 1,
  "openItems": 0,
  "toolFacts": 0
}
```

### ✅ PASS 窗口重写

**证据:**
```json
{
  "writtenCount": 2,
  "loadedCount": 2,
  "content": [
    "新消息 1",
    "新回复 1"
  ]
}
```
