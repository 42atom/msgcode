# v1.0.1 Release Notes

## 概述

v1.0.1 是 v1.0.0 的首个功能迭代，聚焦 **Message -> Desktop 最小闭环**，包含指令路由、安全闸门与会话证据三大核心能力。

## 新增功能

### Batch-T1: Message 指令路由 (`/desktop` 快捷语法)

支持 10 行 Message 指令语法，直接调用 Desktop 能力：

```
/desktop observe {"selector":{...}}
/desktop find {"selector":{...}}
/desktop click {"selector":{...},"confirm":{"token":"<token>"}}
/desktop type {"selector":{...},"text":"...","confirm":{"token":"<token>"}}
/desktop hotkey {"key":"...","confirm":{"token":"<token>"}}
/desktop wait {"condition":{...}}
```

### Batch-T2.1: 安全闸门前移 (Confirm Token 强制)

`click` / `type` / `hotkey` 操作**强制要求** `confirm.token`：

- 移除默认 `"CONFIRM"` 回退
- 无 token 返回 `DESKTOP_CONFIRM_REQUIRED` 错误
- 引导用户通过 `/desktop confirm` 获取 token

### Batch-T3: 会话证据映射

新增 `DesktopSessionStore`，记录每次 Desktop 调用：

- `messageRequestId` - 请求唯一标识
- `method` - 调用方法名
- `executionId` - 执行 ID
- `evidenceDir` - 证据目录路径
- `ts` - 时间戳

输出格式：NDJSON，便于日志分析。

## 文件变更

| 文件 | 变更 |
|------|------|
| `src/routes/commands.ts` | 新增 `/desktop` 快捷语法 + Token 强制校验 |
| `src/runtime/desktop-session.ts` | 新增会话证据存储模块 |
| `scripts/desktop/test-v1.0.1-confirm-token.sh` | 新增 Token 校验测试脚本 |
| `.github/workflows/desktop-smoke.yml` | CI 适配 (job name 对齐) |

## 升级说明

无需特殊迁移。如使用 `/desktop click|type|hotkey`，请确保提供 `confirm.token`。

## 里程碑

- `v1.0.0` - Safari E2E 里程碑冻结
- `v1.0.1` - Message Desktop 路由 + 安全闸门
