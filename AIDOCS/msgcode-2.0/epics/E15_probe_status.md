# E15 - Probe/Status（可观测性与自愈入口）

## 背景
2.0 目标是“可长期运维”。现在链路已经能跑，但缺少一条小白也能用、机器也能解析的自检入口：**probe/status**。

## 目标
- 一条命令看清系统是否“能收、能发、能路由、能跑 tmux/claude”。
- 把“权限/路径/版本/路由配置错误”变成可读的诊断输出。
- 为后续 launchd/守护提供稳定探针（返回码 + 简洁文本）。

## 非目标
- 不做复杂自愈（先做到“准确报错 + 可执行建议”）。
- 不做网络发布/上传（Pinme/OneDrive 属于后续 Epic）。

## CLI 设计
新增命令：
- `msgcode status`
  - 只读、快速、无副作用
  - 输出：当前配置摘要（IMSG_PATH、WORKSPACE_ROOT、routes 数量、log 文件位置）
- `msgcode probe`
  - 运行一组探针，输出每项 OK/FAIL + 建议
  - 失败时退出码非 0（便于守护）

## Probe 项（最小集合）
1) imsg 二进制
   - 存在、可执行、`--version` 可用
2) imsg RPC
   - `rpc --help` 包含 `watch/send/chats`
3) 权限（最佳努力）
   - `imsg chats --limit 1`：若提示 Full Disk Access，则给出明确指引
4) 路由存储
   - `~/.config/msgcode/routes.json` 可读/可解析
   - active routes 数量
5) WORKSPACE_ROOT
   - 目录存在/可写（若不可写，提示 chmod/目录创建）
6) tmux/claude
   - `tmux -V` 可用
   - `claude --version` 可用（或 `which claude`）

## 实现任务（给 Opus）
1) 新增：`src/diagnostics/probe.ts`
   - `runProbe(): { ok: boolean; lines: string[] }`
   - 每项 probe 返回 `{ ok, name, details?, fixHint? }`
2) 改 CLI：`src/cli.ts`
   - 添加 `status`、`probe` 子命令
3) 文档：`README.md`
   - 增加“排障：msgcode probe”一节（最短步骤 + 典型错误提示）
4) 测试
   - 新增：`test/diagnostics.probe.test.ts`
     - 用环境变量/临时目录模拟 routes/workspace
     - 对外部命令执行用可注入 executor（避免真跑 tmux/claude）

## 验收标准
- `msgcode status` 可在 1s 内返回
- `msgcode probe` 对常见错误给出可执行的 fixHint（特别是 Full Disk Access）
- `probe` 退出码：全部 OK → 0；有 FAIL → 1
- `npm test` 全绿，`tsc --noEmit` 通过

