# T15（P1）Menubar 配置化 - 任务单（v2.2）

> 目标：把 Menubar 三键做成“可配置能力”，让开源用户能开关/改快捷键/改默认 workspace；不改变安全语义（Allowlist/Confirm/Evidence/Abort）。

---

## 0. 一句话范围

- **做**：Menubar（Doctor/Observe/Open Evidence）支持配置化（开关/快捷键/默认 workspace/Reload Config）。
- **不做**：不引入新的 Desktop 原语；不改变外部 XPC 协议；不放宽任何安全约束。

---

## 1. 配置契约（P0，先定口径）

### 1.1 配置来源优先级

1. `<WORKSPACE>/.msgcode/config.json`（推荐，项目级）
2. `~/.config/msgcode/config.json`（可选，用户级）
3. 内置默认值

### 1.2 配置字段（建议命名）

```jsonc
{
  "desktop.menubar.enabled": true,

  // Menubar 内部调用 Desktop 原语时使用的 workspace（用于证据落盘）
  "desktop.menubar.workspacePath": "/abs/workspace/path",

  // 三键快捷键（若不支持全局热键，可先只做菜单 item 快捷键）
  "desktop.menubar.shortcuts.doctor": "cmd+d",
  "desktop.menubar.shortcuts.observe": "cmd+o",
  "desktop.menubar.shortcuts.openEvidence": "cmd+e",

  // “打开证据”的策略
  "desktop.menubar.openEvidence.mode": "latest"  // latest | choose
}
```

### 1.3 默认值

- `desktop.menubar.enabled`: `true`
- `desktop.menubar.workspacePath`: **当前进程启动目录**（或由 HostApp 传入）
- `shortcuts.*`: `cmd+d/cmd+o/cmd+e`
- `openEvidence.mode`: `latest`

---

## 2. Batch 切分（按依赖顺序）

### Batch-T15.0（P0）文档与契约对齐

**目标**：把“配置字段名/读取优先级/默认值/生效方式”写清楚。

- 修改/新增文档：
  - `docs/desktop/README.md`：增加 “Menubar 配置” 小节（最短可读）
  - 或 `mac/MsgcodeDesktopHost/README.md`：详细说明（可选）

**验收标准**
- 文档包含：字段表 + 3 个示例（默认/禁用/改快捷键+workspace）
- 明确：需要重启 HostApp 或点击 `Reload Config` 生效（两者选其一或都支持）

---

### Batch-T15.1（P0）HostApp 读取配置 + Reload

**目标**：HostApp 启动时读取配置；支持菜单项 `Reload Config` 重新加载。

**实现要点**
- 文件：`mac/MsgcodeDesktopHost/HostApp/main.swift`
- 新增 `ConfigLoader`（或等价小模块）：
  - 解析 JSON（容错：缺字段走默认）
  - 读取 workspace 级与用户级
  - 合并策略：workspace 覆盖 user，user 覆盖默认

**验收标准**
- 改 `desktop.menubar.enabled=false` → Menubar 三键隐藏/置灰
- 改 `workspacePath` → observe 的 evidence 落盘到指定 workspace
- `Reload Config` 生效（不要求热更新监听文件）

---

### Batch-T15.2（P0）三键行为收口（真实调用）

**目标**：Menubar 三键全部走“进程内 internal 调用”，不依赖 desktopctl，不走外部 allowlist。

**实现要点**
- `Doctor`：调用 `desktop.doctor`，弹窗显示 `healthy/issues/permissions`
- `Observe`：调用 `desktop.observe`，完成后显示 `executionId/evidence.dir`，提供 “Open” 按钮
- `Open Evidence`：
  - `latest`：打开最近 evidence 目录
  - `choose`：可选（弹列表/打开 Finder 让用户自己选）

**验收标准**
- 三键均可在无 desktopctl 的情况下工作
- observe 生成证据三件套（按当前权限）
- internal 调用语义清晰：`peer == nil` 跳过 allowlist（不使用魔法字符串）

---

### Batch-T15.3（P1）可观测性与边界说明

**目标**：Menubar 的动作也写入 events（可选），并在文档中明确边界。

**验收标准**
- `events.ndjson` 至少包含 `desktop.start/stop/error`（已有约定）
- 若新增 `menubar.*` 事件：必须是附加，不影响现有最小事件集

---

## 3. 风险与约束（必须遵守）

- 不新增绕过确认的副作用路径：click/typeText/hotkey 仍必须 confirm token
- 不放宽 allowlist：外部调用仍受 allowlist 控制；internal 只用于 Menubar 自己
- workspacePath 必须遵守 “证据落盘在 workspace 内” 的校验（保持现有规则）

---

## 4. 交付回报模板（给 Claude/Opus）

1. 修改文件列表（按文件一行）
2. 关键行为（3 条）
3. 验收证据（命令/截图/日志路径）
4. 已知限制（若有）

