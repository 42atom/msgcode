# Plan: Patchright 浏览器底座切换（Chrome-as-State）

Issue: 0016

## Problem

Phase A 已经证明 Patchright 在直启和 `connectOverCDP` 模式下都能通过当前 browserscan 的 WebDriver/CDP 检测，而现有正式主链仍然绑定 PinchTab orchestrator。继续保留 PinchTab 作为正式底座，会让启动链、prompt 和 browser runner 继续围绕一个已经被判定为长期不合适的 substrate 演进。

## Occam Check

- 不加它，系统具体坏在哪？
  正式浏览器主链会继续依赖 PinchTab baseUrl / binary / orchestrator，而这条链在反检测层面已经不满足长期目标。
- 用更少的层能不能解决？
  能。直接把正式底座替换成 Patchright + `connectOverCDP`，不新增 daemon，不保留双底座兼容。
- 这个改动让主链数量变多了还是变少了？
  变少了。浏览器底座从“正式 PinchTab + 已验证 Patchright 实验”收口成一条正式 Patchright 主链。

## Decision

采用 **Chrome-as-State** 方案：

1. Chrome 进程是状态真相源。
2. msgcode 通过 `connectOverCDP` 连接到固定 remote debugging port。
3. 使用现有 `chrome-root.ts` 提供的 profile 根路径与 launch command。
4. 不再保留 PinchTab runtime / orchestrator / binary 注入。
5. `ref` 升级为无状态可重建结构，最小字段为：
   - `role`
   - `name`
   - `index`

## Alternatives

### 方案 A：Patchright Daemon

- 优点：更接近原 PinchTab orchestrator 心智。
- 缺点：重新引入长生命周期服务，相当于再造一个控制面。

### 方案 B：Chrome-as-State（推荐）

- 优点：利用已验证的 `connectOverCDP`，直接把状态交给 Chrome 进程。
- 缺点：需要自己管理 instanceId / tabId / pid 文件。

推荐：方案 B。

## Current Truth Source

正式口径（现役）：

- `src/runners/browser-patchright.ts`
- `src/skills/runtime/patchright-browser/SKILL.md`
- `prompts/agents-prompt.md`
- `src/agent-backend/tool-loop.ts`
- `src/commands.ts`

历史档案 / 回滚锚点（保留，但不再作为正式执行真相源）：

- `src/runners/browser-pinchtab.ts`
- `src/browser/pinchtab-runtime.ts`
- `src/skills/runtime/pinchtab-browser/`
- `issues/0013-pinchtab-single-browser-substrate-bootstrap.md`
- `docs/design/plan-260307-pinchtab-single-browser-substrate-bootstrap.md`
- `docs/design/plan-260307-runtime-skill-source-sync.md`

## 方法解释

### 1. Instance 模型

- `instances.launch`
  - 调 `ensureChromeRoot()` 获取 `chromeRoot` 与 `launchCommand`
  - 启动本地 Chrome（带 `--remote-debugging-port`）
  - `instanceId` 采用可重建格式：`chrome:<rootName>:<port>`
- `instances.list`
  - 扫描 `profilesRoot` 下的 pid/state 文件
  - 对存活的 Chrome 进程输出实例列表
- `instances.stop`
  - 通过 pid 文件或端口反查进程并停止

### 2. Tab 模型

- 每次操作都重新 `connectOverCDP`
- `tabs.list`
  - 枚举 `context.pages()`
  - 通过 CDP target info 提取稳定 `targetId`
  - `tabId = targetId`
- `tabs.open`
  - 新建页面后用 targetId 作为返回 tabId

### 3. Snapshot / Ref

- `tabs.snapshot`
  - 通过 `locator("body").ariaSnapshot()` 生成结构摘要
  - 同时导出一份候选元素表
- `ref`
  - 不再使用进程内 `e0/e1`
  - 改为字符串化结构，例如：

```json
{"role":"link","name":"hide","index":5}
```

- `tabs.action`
  - 每次根据 `ref.role + ref.name + ref.index` 重新定位
  - 只做无状态重建，不依赖任何内存缓存

### 4. Prompt / Runtime

- 删除 PinchTab baseUrl / binary path / skill 的正式注入
- 正式浏览器通道改为：
  - Patchright `browser` 工具
  - Chrome root / profilesRoot / launchCommand

## Plan

1. Runner 替换
- 新增：
  - `src/runners/browser-patchright.ts`
- 删除/退役：
  - `src/runners/browser-pinchtab.ts`
  - `src/browser/pinchtab-runtime.ts`
- 验收点：
  - browser 11 个 operation 都由 Patchright 实现

2. CLI / Tool Bus / Gmail 只读接线
- 修改：
  - `src/cli/browser.ts`
  - `src/tools/bus.ts`
  - `src/browser/gmail-readonly.ts`
- 验收点：
  - CLI 与 tool bus 都切到新 runner

3. 启动链与 prompt 收口
- 修改：
  - `src/commands.ts`
  - `src/agent-backend/tool-loop.ts`
  - `prompts/agents-prompt.md`
- 验收点：
  - 不再暴露 PinchTab orchestrator/baseUrl/binary
  - 改为暴露 Chrome root / launch command / Patchright 单一路径

4. Manifest / tests / docs
- 修改：
  - `src/tools/manifest.ts`
  - `test/p5-7-r7a-browser-contract.test.ts`
  - `test/p5-7-r7a-browser-runner.test.ts`
  - `test/p5-7-r7b-gmail-readonly.test.ts`
  - `test/p5-7-r8c-llm-tool-manifest-single-source.test.ts`
  - `test/p5-7-r9-t2-skill-global-single-source.test.ts`
  - `test/p5-7-r13-pinchtab-bootstrap.test.ts`
  - `issues/0013-pinchtab-single-browser-substrate-bootstrap.md`
  - `docs/CHANGELOG.md`
- 验收点：
  - PinchTab 专属口径已退场

## Risks

1. `targetId` 获取不稳定会导致 tabId 断裂。
回滚/降级：先在 runner 单测中锁住 targetId 提取，再替换主链。

2. Chrome 进程 pid/state 文件若写坏，会影响 `instances.list/stop`。
回滚/降级：pid 文件只作为辅助，端口探测为最终真相。

3. 现有测试大量写死 PinchTab 语义，替换时容易出现假红。
回滚/降级：按 runner -> CLI -> prompt -> docs 顺序小步迁移，不混改。

## Rollback

- 回退 `browser-patchright` runner 接线和 prompt 改动。
- 恢复 `src/browser/pinchtab-runtime.ts` 与 `src/runners/browser-pinchtab.ts` 为正式路径。

## Test Plan

- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r7a-browser-contract.test.ts`
- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r7a-browser-runner.test.ts`
- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r7b-gmail-readonly.test.ts`
- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r8c-llm-tool-manifest-single-source.test.ts`
- `PATH="$HOME/.bun/bin:$PATH" bun test test/p5-7-r9-t2-skill-global-single-source.test.ts`

## Observability

- browser runner 至少记录：
  - `instanceId`
  - `port`
  - `chromeRoot`
  - `tabId`
  - `ref.role/name/index`
- `instances.launch/stop` 必须打启动与退出证据。

（章节级）评审意见：[留空，用户将给出反馈]
