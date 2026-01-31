# Tax / Accounting Browser Workflow Spec（v2.1）

> 目标：让 msgcode 能在**本机**完成“记账/报税”这类高敏业务的浏览器工作流，同时把风险锁死：**可审计**、**可恢复**、**默认无副作用**、**必须二次确认**。

## 0) 适用范围

- 记账/报税网站、银行/信用卡账单下载、SaaS 财务后台导出（CSV/PDF）、税务申报网站填表/提交。
- 本 spec 只定义：安全边界、CLI 形态、证据落盘规范；具体站点适配留到后续实现。

## 1) 核心原则（抄 OpenClaw 的“现实主义”）

1. **Host Browser + 手动登录**：不存账号密码，不自动登录；由用户在专用浏览器 profile 内完成登录。
2. **两段式提交**：先生成“提交计划”（planned actions + fields diff + 证据截图），再 `--confirm` 才允许执行点击/提交/付款。
3. **证据优先**：每次执行都落盘“证据包”（截图/导出文件/请求上下文摘要）；日志只存 digest，不存隐私正文。
4. **最小权限**：命令默认只读（抓取/导出）；任何副作用动作默认禁用，需要显式开关。
5. **可恢复**：计划与证据均可落盘；daemon/CLI 中断后可从 `requestId` 继续（至少能重放计划、重跑导出）。

## 2) 权限与隔离（必须）

- **workspace 隔离**：每个项目/群（workspace）拥有独立的财务资料与证据目录；默认禁止跨 workspace 读取。
- **owner-only**：`tax/*` 命令只允许 CLI（owner）触发；群内消息禁止触发任何 tax 动作（防误触/社工）。
- **Host profile 隔离**：使用独立浏览器 profile（例如 `msgcode-tax`），与日常浏览隔离 Cookie/扩展。

## 3) CLI 形态（JSON-first）

> 所有命令遵循 `cli_contract_v2.1.md` 的 Envelope：`schemaVersion + requestId + durationMs + status + warnings/errors[]`。

### 3.1 `msgcode tax status --json`

- 输出：能力是否启用、host browser 可用性、profile 路径、最近一次 requestId、证据目录大小。

### 3.2 `msgcode tax prepare ... --json`

- 目的：生成**计划**（不执行副作用）。
- 示例：
  - `msgcode tax prepare --workspace <id> --site <name> --task downloadStatements --month 2026-01 --json`
  - `msgcode tax prepare --workspace <id> --site <name> --task fillReturnDraft --year 2025 --json`
- 输出 `data.planned`：
  - `actions[]`（read/export/fill/submit 等，必须声明 sideEffects）
  - `requirements[]`（如：需要已登录/需要验证码/需要打开某页面）
  - `evidencePlan[]`（将要保存哪些截图/文件）

### 3.3 `msgcode tax run --request <requestId> [--confirm <phrase>] [--json]`

- 目的：执行 `prepare` 生成的计划。
- 规则：
  - 无 `--confirm`：只允许执行 `read-only`/`export`（不点提交/不付款）。
  - 有 `--confirm`：允许执行 `submit`/`payment` 等高风险动作。
  - `--confirm` 建议要求固定短语（例如 `I_CONFIRM_TAX_SUBMIT`），避免误触。

### 3.4 `msgcode tax archive --request <requestId> --json`

- 目的：把导出文件/回执页/确认页截图归档到 workspace，并写入 memory 日志（仅摘要 + digest）。

### 3.5 `--dry-run`（强制支持）

- `prepare/run/archive` 都应支持 `--dry-run`：
  - 输出 Envelope，`data.dryRun=true`，只打印 planned writes / planned clicks，不实际执行。

## 4) 证据落盘规范（Evidence Bundle）

每次 `prepare/run/archive` 以 `requestId` 作为主键落盘：

```
<workspace>/
└── artifacts/
    └── tax/
        └── 2026-01-31/
            └── <requestId>/
                ├── plan.json
                ├── screenshots/
                │   ├── 001_before_submit.png
                │   └── 002_after_submit.png
                ├── exports/
                │   ├── statements_2026-01.csv
                │   └── receipt.pdf
                └── summary.md
```

同时追加写入：

- `<workspace>/memory/YYYY-MM-DD.md`：只写 **摘要**（不写明细），附 `requestId + files[] digest`。

## 5) 错误码（建议新增 TAX 前缀）

- `TAX_CAPABILITY_DISABLED`：功能未启用（默认应为禁用）
- `TAX_LOGIN_REQUIRED`：未在 host profile 登录
- `TAX_CONFIRM_REQUIRED`：尝试执行副作用动作但未提供 `--confirm`
- `TAX_SITE_CHANGED`：页面结构变化导致 selector 失效（要求落盘截图）
- `TAX_EXPORT_FAILED`：导出/下载失败
- `TAX_SUBMIT_FAILED`：提交失败（要求落盘回执页/错误页）

## 6) 实现建议（最小可行路径）

### Phase P0：只读导出闭环

- 只做 `status + prepare(download) + run(export) + archive`。
- 默认只读：不允许提交/付款。
- 先支持 1 个站点/1 条导出路径（CSV/PDF），验证证据链条与落盘。

### Phase P1：填表草稿 + 人工确认提交

- 新增 `fillReturnDraft`（仅填草稿，不点提交）。
- 提交必须 `--confirm`，且强制保存“before/after submit”截图与回执 PDF。

### Phase P2：Jobs 联动（可选）

- 允许 job 定时触发 `prepare(downloadStatements)`，但 `run` 仍需 owner `--confirm`（禁止无人值守提交）。

