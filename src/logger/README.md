# src/logger

日志系统模块，提供轻量级日志能力。

## 架构

```
logger/
├── index.ts           # Logger 类、单例、公共接口
├── console-transport.ts  # 控制台传输器
├── file-transport.ts  # 文件传输器（支持轮转）
└── format-text.ts     # 文本字段格式化工具
```

## 模块职责

### index.ts
- Logger 类：多传输器、日志级别控制
- 单例导出：`logger`
- 公共函数：`setLogLevel`、`resetLogLevel`、`initLoggerFromSettings`

### console-transport.ts
- 控制台输出（可选颜色化）
- 支持日志级别过滤

### file-transport.ts
- 文件输出（支持 ~ 路径展开）
- 自动轮转（按大小）
- 格式化输出：`inboundText`、`responseText` 等字段

### format-text.ts
- 纯函数：`formatLogTextField(value, maxChars)`
- 统一处理：转义 `\/"/\n` + 截断
- 仅模块内复用，不对外 re-export

## 调用边界

```
file-transport.ts
    └── formatLogTextField()  // 静态 import
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `LOG_LEVEL` | 日志级别（debug/info/warn/error） |
| `LOG_CONSOLE` | 是否输出到控制台（默认 true） |
| `LOG_FILE` | 是否输出到文件（默认 true） |
| `LOG_PATH` | 日志文件路径 |
| `MSGCODE_LOG_PLAINTEXT_INPUT` | 是否记录用户输入明文（默认 false） |
| `DEBUG_TRACE_TEXT` | 是否记录文本预览（默认 false） |

## 测试

```bash
bun test test/logger.format-text.test.ts
bun test test/logger.file-transport.test.ts
```
