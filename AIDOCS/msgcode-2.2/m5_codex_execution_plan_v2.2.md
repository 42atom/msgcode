# M5：Codex 兼容（常驻 tmux 执行臂）执行计划（v2.2）

> 目标：让你在 iMessage 里把 msgcode 当“远程入口”，把 Codex 当“常驻执行臂”（跑在 tmux 里），实现 **稳定对话 / 稳定办事 / 重启不丢会话**。  
> 原则：**会话常驻** + **文件为真相源**（Codex JSONL）+ **workspace 门禁**（policy.mode）。

---

## 0) P0 范围（只做必要的）

- 群内切换到 codex：`/model codex`（落盘为该 workspace 默认执行臂）
- `/start` 启动/恢复 Codex tmux 会话（**常驻进程**，不是“每条消息启动一次”）
- 普通消息通过 tmux 发送到 Codex，会从 `~/.codex/sessions/**/rollout-*.jsonl` 抽取回复并回发
- `doctor/preflight` 能明确提示：codex 是否可用、为何不可用、怎么修
- `local-only` 时禁止 codex（需要显式切到 `egress-allowed` 才能用）

不做（P1/M7 再做）：
- 把 codex 的“副作用工具”纳入 msgcode `/approve` 风控总线（先让 Codex 自己的 sandbox/approval 兜底）
- 复杂多会话/多 agent 叙事（保持禅意）

---

## 1) 任务清单（给 Opus）

### M5-1 配置落盘（workspace 真相源）

- [ ] 扩展 `<WORKSPACE>/.msgcode/config.json`：
  - `policy.mode`: `local-only | egress-allowed`
  - `runner.default`: `lmstudio | codex | claude-code`
- [ ] `/model codex` 行为：
  - 写入 `runner.default=codex`
  - 若 `policy.mode=local-only`：拒绝并给 fixHint（如何改为 egress-allowed）
- [ ] `/model`（无参）展示：
  - 当前 workspace 的 `runner.default`
  - 当前 `policy.mode`

验收：
- 重启 daemon 后 `/model` 仍显示 codex（落盘生效）

---

### M5-2 Codex 依赖探测（doctor/preflight）

- [ ] preflight 增加 `codex` 依赖项（bin 检查：`codex --version`）
- [ ] doctor 增加 “runner/codex” 摘要：
  - installed? version?
  - mode 是否允许 egress？
  - 当前 workspace 是否选择了 codex？
- [ ] fixHint：
  - 未安装：提示需要安装 Codex CLI（并给 `codex --version` 自检方式）
  - local-only：提示如何切到 egress-allowed

验收：
- `msgcode doctor --json` 能稳定输出 codex 状态（无 codex 时也不崩）

---

### M5-3 Codex 常驻 tmux（T1–T5）

核心结论（定案）：
- **/start 才启动会话**；/model 只是把执行臂选型落盘
- Codex 会话持久化由 Codex 自己负责：`codex resume --last -C <workspace>`
- msgcode 只做两件事：
  1) 往 tmux 里 **send-keys**（输入）
  2) 从 Codex JSONL 里 **抽取 output_text**（输出）

实现要点（P0）：
- 启动（T1）：
  - `codex resume --last --no-alt-screen -C <workspace>`
  - 无历史时 fallback：`codex --no-alt-screen -C <workspace>`
- 发送（T2）：
  - tmux send-keys 输入消息
- 抽取（T3）：
  - 读取 `~/.codex/sessions/**/rollout-*.jsonl`
  - **按 session_meta.payload.cwd==projectDir 过滤**，防跨 workspace 串味/泄露
  - 只取 `response_item.payload.role=assistant` 的 `content[].type=output_text`
  - 完成判定：稳定计数（连续 N 次无新增）
- 续会话（T4）：
  - daemon 重启不影响 tmux；/start 可恢复；Codex JSONL 是真相源
- 兼容保留（T5）：
  - 仍保留 `codex exec` 一次性 runner（用于兜底/脚本化/未来对接风控总线）

---

### M5-4 消息分流（让手机对话真的走到 codex）

- [ ] 入口分流规则（P0）：
  - 如果当前 workspace `runner.default=codex`：普通消息走 codex runner
  - 否则：保持现有（lmstudio/claude）
- [ ] 仍需保留 slash commands（本地处理，不交给 codex）：
  - `/help /bind /where /model /reload`
  - 其它保持现状（P1 再收口）

验收：
- `/policy egress-allowed` → `/model codex` → `/start` 后发普通消息 → 返回来自 codex 的答复
- `/model lmstudio` 后发普通消息 → 返回来自本地模型的答复

---

## 2) 最小验收脚本（人工）

在 iMessage 群里：
1) `/model`（确认当前 mode/runner）
2) `/model codex`（若提示 local-only，先按提示把 mode 改为 egress-allowed）
3) `/start`（启动/恢复 Codex tmux 会话）
4) 发一句：`南京是哪里的城市？`
5) 预期：1 条简短正常回复（不出现“用户上传了一张图片/约束/分析”等元叙事）
6) 重启 daemon 后：
   - `/model` 仍显示 codex（落盘生效）
   - `/start` 可恢复会话继续对话（会话不丢）

---

## 3) 风险提示（P0 先避开）

- Codex 的 sandbox/approval 目前由 Codex 自己控制（`~/.codex/config.toml` 或 CLI flags）；M7 再接入 msgcode `/approve`
- JSONL schema 可能随 Codex 版本变化：必须有单测覆盖关键解析
- 必须按 `cwd` 过滤 JSONL（跨 workspace 串味是 P0 事故）
