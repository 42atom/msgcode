# msgcode Daemon 保活收口到 launchd

## Problem

`msgcode` 现在的“常驻”其实只有一半成立：应用内有 `HeartbeatRunner` 和 `TaskSupervisor`，但进程本身只是 `msgcode start` 启出来的 detached child。只要 daemon 因未捕获异常、原生依赖连坐、或未知退出而消失，现有系统不会自动拉起。`heartbeat` 只是活着时的内部调度器，不是进程保活层。

真实证据已经出现：

- [msgcode.log](/Users/admin/.config/msgcode/log/msgcode.log) 在 `2026-03-10 01:35:55` 到 `01:36:16` 期间 browser 已连续成功 3 次
- 之后日志直接断掉
- 直到 `01:38:35` 才人工重启

这说明当前缺口不是“任务不会续跑”，而是“**进程死了没人管**”。

## Occam Check

- 不加它，系统具体坏在哪？
  daemon 一旦退出，24 小时在线目标立即失效；`/task`、heartbeat、schedule 都会停摆，只能人工 `restart`。
- 用更少的层能不能解决？
  能。保活直接交给 macOS `launchd`，应用内只补 crash 日志；不需要新增内部 watchdog、恢复层、控制面。
- 这个改动让主链数量变多了还是变少了？
  变少了。把“进程保活”从应用内拿掉，收口到 OS；应用内只保留一条任务续跑主链。

## Alternatives

### 方案 A：继续靠现有 detached daemon + heartbeat

优点：

- 不改启动方式

缺点：

- 进程死后无自愈
- heartbeat 无法复活死进程
- 继续依赖人工重启

结论：

- 否决。已被真实故障证明不满足目标。

### 方案 B：在 msgcode 内新增 watchdog 线程/父进程

优点：

- 理论上可自拉起

缺点：

- 在应用内部再造一层 supervisor
- 与现有 detached 启动、singleton、heartbeat 交叉，复杂度高
- 很容易演化成控制面

结论：

- 否决。属于为了补应用外问题而在应用内加层。

### 方案 C：保活交给 launchd，应用内只补最小观测

优点：

- 符合 macOS 原生服务管理方式
- 保活责任清晰
- 与 `HeartbeatRunner`/`TaskSupervisor` 边界清楚
- 最薄

缺点：

- Phase 1 仅覆盖 macOS
- 需要补一条 daemon install/status 主链

结论：

- 采用。

## Decision

采用 **“launchd 外部保活 + daemon 入口最小 crash 观测 + 应用内 heartbeat 只管任务”** 的薄方案。

关键决策：

1. **不把 heartbeat 改造成进程 watchdog**
2. **不在 `msgcode` 内再发明 supervisor 进程**
3. **Phase 1 只做 macOS launchd**
4. **`TaskSupervisor` / `/task` 的 attempt budget 与进程保活解耦**

## Plan

### Phase 1：补 daemon 顶层 crash 观测

目标：

- 下次再死时先拿到真栈，不再黑盒

改动：

- [src/daemon.ts](/Users/admin/GitProjects/msgcode/src/daemon.ts)
  - 对齐 [src/index.ts](/Users/admin/GitProjects/msgcode/src/index.ts)
  - 增加：
    - `process.on("uncaughtException")`
    - `process.on("unhandledRejection")`
  - 输出：
    - 统一错误日志
    - 最后错误摘要
    - 退出原因 marker

验收：

- 人工注入未处理异常时，log 中可看到明确 crash 记录

### Phase 2：增加最小 launchd 托管能力

目标：

- `msgcode` daemon 由 `launchd` 负责常驻与自动拉起

改动：

- 新增最小 `launchd` 管理模块
  - 生成 LaunchAgent plist
  - 安装 / 卸载 / 重启 / 读取状态
- `msgcode start`
  - 从“直接 detached child”改为“确保 LaunchAgent 已安装并启动”
- `msgcode stop`
  - 通过 `launchctl bootout/stop` 停止

建议路径：

- `~/Library/LaunchAgents/ai.msgcode.daemon.plist`
- stdout/stderr：
  - `~/.config/msgcode/log/daemon.stdout.log`
  - `~/.config/msgcode/log/daemon.stderr.log`

验收：

- 杀掉 daemon 进程后，`launchd` 自动拉起
- App/终端退出不影响 daemon 常驻

### Phase 3：补一个最小 status 口径

目标：

- 用户和我们都能快速判断“服务活没活、上次怎么死的”

改动：

- 新增轻量 status 输出
  - 运行中 / 未运行
  - pid
  - last exit status / reason（若 launchd 可读）
  - 最后一条 daemon 错误线

不做：

- 不做 `status --all`
- 不做控制面 dashboard
- 不做多平台 service 总线

验收：

- 无需翻多份日志，也能看出当前服务状态和最近失败摘要

## Scope

### In Scope

- macOS launchd 托管
- daemon 顶层 crash 观测
- 最小 status / log 诊断

### Out of Scope

- Linux systemd
- Windows Scheduled Task
- 应用内 watchdog
- restart storm/backoff 平台化
- 把 heartbeat 改造成进程监督器

## Risks

- 风险 1：`launchd` plist/环境变量路径不一致
  - 缓解：在 status 输出中明确显示 command / working dir / log 路径

- 风险 2：启动入口从 detached child 切到 launchd 后，现有 `restart`/singleton 有兼容问题
  - 缓解：先保留旧入口为 fallback，仅在 macOS 下切换主路径

- 风险 3：外部依赖（如 LM Studio native crash）仍可能拖挂当前 turn
  - 缓解：本方案只解决“死后能拉起”，不承诺治好所有 native crash

## Rollback

- 若 launchd 主链不稳：
  - 回退到当前 detached child 启动
  - 保留 Phase 1 的 crash 观测，不回退

## Test Plan

1. `msgcode start`
   - 安装并启动 LaunchAgent
2. `launchctl print gui/<uid>/ai.msgcode.daemon`
   - 可读到运行状态与 pid
3. 人工 `kill -9 <pid>`
   - 验证自动重启
4. 注入未捕获异常
   - 验证 stderr / 主日志里有 crash 原因
5. 跑一条 browser smoke
   - 验证 daemon 常驻不受终端关闭影响

## Implementation Notes

- 已新增 [src/runtime/launchd.ts](/Users/admin/GitProjects/msgcode/src/runtime/launchd.ts)，负责：
  - 生成 LaunchAgent plist
  - `launchctl print/bootstrap/kickstart/bootout`
  - 最小 stdout/stderr 路径约定
- [src/cli.ts](/Users/admin/GitProjects/msgcode/src/cli.ts) 在 macOS 下已切到 launchd 主链：
  - `start` / `stop` / `restart` 走 LaunchAgent
  - 非 macOS 仍保留原 detached fallback
- [src/daemon.ts](/Users/admin/GitProjects/msgcode/src/daemon.ts) 已补：
  - `uncaughtException`
  - `unhandledRejection`
- [src/commands.ts](/Users/admin/GitProjects/msgcode/src/commands.ts) 已补两条关键收口：
  - launchd 场景下 `messages_db` 从启动硬阻塞降级为告警
  - `imsg` 在 launchd/TCC 下初始化失败时，自动降级为只保留其余 transport，不再拖垮整进程
- [src/probe/probes/daemon.ts](/Users/admin/GitProjects/msgcode/src/probe/probes/daemon.ts) 已接入 `msgcode status`

## Verification

- Tests:
  - `bun test test/runtime.launchd.test.ts`
  - `bun test test/p5-7-r28-daemon-probe.test.ts`
  - `bun test test/commands.startup-guard.test.ts`
- Runtime:
  - `./bin/msgcode start`
    - 返回：`msgcode 已由 launchd 启动 (PID: 33083)`
  - `./bin/msgcode restart`
    - 返回：`msgcode 已重启 (PID: 33413)`
  - `launchctl print gui/$(id -u)/ai.msgcode.daemon`
    - 看到：`state = running`, `pid = 33413`
  - `./bin/msgcode status --json`
    - 看到：`categories.daemon.status = pass`

## Operational Notes

- 当前 macOS launchd 会话下，`imsg` 访问 `chat.db` 仍会返回权限文本而不是 JSON-RPC 响应。
- 本轮不做 TCC 平台化修复；策略是：
  - 不让它阻塞 daemon 启动
  - 保留 `feishu` 等其余 transport 常驻
  - 由日志明确暴露 `imsg transport 初始化失败，已降级为仅保留其余 transport`

## Evidence

- Research:
  - [research-260310-openclaw-daemon-keepalive.md](/Users/admin/GitProjects/msgcode/docs/notes/research-260310-openclaw-daemon-keepalive.md)
- Code:
  - [src/cli.ts](/Users/admin/GitProjects/msgcode/src/cli.ts)
  - [src/daemon.ts](/Users/admin/GitProjects/msgcode/src/daemon.ts)
  - [src/runtime/heartbeat.ts](/Users/admin/GitProjects/msgcode/src/runtime/heartbeat.ts)
  - [src/commands.ts](/Users/admin/GitProjects/msgcode/src/commands.ts)
  - [openclaw service.ts](/Users/admin/GitProjects/GithubDown/openclaw/src/daemon/service.ts)
  - [openclaw launchd.ts](/Users/admin/GitProjects/GithubDown/openclaw/src/daemon/launchd.ts)

评审意见：[留空,用户将给出反馈]
