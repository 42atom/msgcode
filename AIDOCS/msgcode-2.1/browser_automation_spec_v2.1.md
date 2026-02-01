# Browser Automation Spec（v2.1）

> 目标：把“让 agent 用浏览器做事”抽象成可复用的底座能力，不绑定税务/记账等具体业务。
>
> 核心取舍：**Default to Serial**（高敏默认串行）+ **Two-phase commit**（prepare→confirm→run）+ **证据优先**（可审计、可恢复）。

## 1) 能力边界

### 1.1 Browser Core（通用）
- 语义快照（Semantic Snapshot / ARIA tree）：用于交互与定位元素。
- 截图（Screenshot）：用于取证与回放。
- 下载/导出（Export）：CSV/PDF/附件落盘（证据包的一部分）。

### 1.2 Safe Execution（高敏执行框架）
- **lane/queue 串行队列**：同一 `workspaceId`/`sessionId` 的浏览器操作默认串行，避免 async 并发导致状态污染。
- **两段式提交**：`prepare(plan)` 产出可审计计划；`run(--confirm)` 才执行副作用步骤。
- **requestId 贯穿**：计划、证据、日志都以 requestId 关联，便于恢复与追踪。

### 1.3 Domain Pack（业务包）
税务/记账/发帖/报销/采购等，都只是“业务包”：
- 提供：字段 schema、校验规则、站点选择器策略、导出路径。
- 不得：绕过 Safe Execution 框架直接点击提交/付款。

## 2) 权限与隔离（默认保守）

- **Host browser + 手动登录**：不存账号密码，不自动登录；使用独立 profile（例如 `msgcode-browser`）。
- **workspace 隔离**：证据与导出文件默认只落当前 workspace；跨 workspace 读取默认禁止。
- **owner-only 高敏动作**：群内消息禁止触发 `browser_act`；只允许 CLI（owner）触发副作用执行。

## 3) 交互策略：Semantic Snapshot vs Screenshot

结论：
- **交互**用 Semantic Snapshot（小、稳、可检索、对“找按钮/填表单”友好）。
- **取证**必须落 Screenshot/Export（可审计、可复盘、站点变更可定位）。

## 4) 两段式执行（Two-phase commit）

### 4.1 `prepare` 输出：BrowserPlan

`prepare` 阶段只允许：
- 导航（read-only）
- 采集语义快照（read-only）
- 生成计划与证据清单（local-write）

计划应包含：
- `actions[]`：每步动作（read/export/fill/submit/payment）
- `sideEffects`：read-only / local-write / browser-act
- `requirements[]`：需要已登录/需要验证码/需要人工介入
- `evidencePlan[]`：必须保存哪些截图/导出文件
- `diff`：关键字段变更（例如将提交的表单字段 diff）

### 4.2 `run` 执行规则

- 无 `--confirm`：只允许执行 `read-only` / `export` 步骤。
- 有 `--confirm <phrase>`：允许执行 `browser-act`（填表/点击提交/付款）。
- `--confirm` 建议要求固定短语（防误触），并强制落盘提交前后截图。

## 5) 证据包（Evidence Bundle）

建议目录结构（以 `requestId` 为主键）：

```
<workspace>/
└── artifacts/
    └── browser/
        └── YYYY-MM-DD/
            └── <requestId>/
                ├── plan.json
                ├── snapshots/
                │   └── 001_home.aria.txt
                ├── screenshots/
                │   ├── 001_before_submit.png
                │   └── 002_after_submit.png
                ├── exports/
                │   └── statements_2026-01.csv
                └── summary.md
```

隐私基线：
- 日志只存 `textLength/textDigest`；证据包可存截图/导出文件（本机、workspace 隔离）。
- 任何跨 workspace 汇总必须走 owner-only，并显式二次确认。

## 6) 错误码（建议，待并入 cli_contract）

建议新增 `BROWSER_*`：
- `BROWSER_CAPABILITY_DISABLED`：浏览器能力未启用
- `BROWSER_LOGIN_REQUIRED`：未在 host profile 登录
- `BROWSER_CONFIRM_REQUIRED`：缺少 `--confirm` 但尝试执行副作用
- `BROWSER_SITE_CHANGED`：站点结构变化导致 selector 失效
- `BROWSER_EXPORT_FAILED`：导出失败
- `BROWSER_SUBMIT_FAILED`：提交失败

## 7) 最小落地顺序（建议）

1. 只读导出闭环：snapshot + export + evidence bundle（无提交）
2. 加入 `prepare(diff)`：让提交前“看得见将要发生什么”
3. 最后才做 `browser_act --confirm`：并强制 before/after 截图

