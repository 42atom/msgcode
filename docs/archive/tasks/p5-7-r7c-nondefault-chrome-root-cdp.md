# 任务单：P5.7-R7C（非默认 Chrome 数据根 + CDP 验证）

Issue: 0004
Plan: docs/plan/pl0004.cand.browser.web-transaction-platform-core.md

优先级：P1

## 任务一句话

把共享工作 Chrome 的数据根切到 `WORKSPACE_ROOT/.msgcode/chrome-profiles/` 下的非默认路径，并验证该路径下的 Chrome 能正常开启 remote debugging / CDP，供 PinchTab 接入。

## 背景

1. 当前已确认：
   - 用户的日常主浏览器是 Safari
   - Chrome 整体作为人机共用的工作浏览器
2. 当前技术阻塞：
   - Chrome 136+ 不再尊重官方默认真实数据目录上的 remote debugging 开关
   - 因此 `~/Library/Application Support/Google/Chrome` 不能再作为 PinchTab/CDP 的主路径

## 目标（冻结）

1. 选择并固定一个 `WORKSPACE_ROOT/.msgcode/chrome-profiles/` 下的非默认 Chrome 数据根
2. 用该目录启动 Chrome
3. 验证 `--remote-debugging-port` 真正生效
4. 为后续 PinchTab 接入 Gmail 只读 smoke 提供可用前提

## 非目标

1. 不做 Gmail 提取逻辑
2. 不做桌面自动化
3. 不做 profile copy/migration 自动化全流程

## 推荐默认路径

`$WORKSPACE_ROOT/.msgcode/chrome-profiles/work-default/`

## 硬验收

1. Chrome 可从该非默认数据根正常启动
2. `http://127.0.0.1:<port>/json/version` 可正常返回
3. PinchTab 能通过 `CDP_URL` 连接
4. `npm run docs:check` 通过
