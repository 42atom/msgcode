---
name: patchright-browser
description: This skill should be used when the model needs real webpage access, long-form page text extraction or transcription, or to inspect and drive the Patchright browser CLI, verify Chrome root state, and diagnose browser instances and tabs in msgcode.
---

# patchright-browser skill

## 能力

本 skill 是 Patchright 浏览器能力说明书，用来说明 `browser` 原生工具与 `msgcode browser` CLI 的正确分工、长文网页处理主链、以及排障合同。

- 正式浏览器通道：`browser` 工具（Patchright + Chrome-as-State）
- 本 skill 作用：
  - 提供浏览器任务的分层打法
  - 提供长文网页转写/保存链接的固定主链
  - 提供 CLI 合同、状态检查路径、最小命令模板
- 本 skill 不替代正式 `browser` 工具，也不重新发明第二套浏览器底座

## 何时使用

在以下场景读取并使用本 skill：

- 真实网页访问、正文读取、截图、点击
- 长文网页转写、文章整理成 Markdown、保留原文链接或图片链接
- 浏览器自动化排障
- Patchright browser CLI 合同确认
- Chrome root / profiles / instances / tabs 状态检查
- 需要显式通过 `msgcode browser` 检查或执行浏览器命令

## 唯一入口

优先入口：`browser` 原生工具

- 做真实网页访问、截图、点击、读取标题/正文时，**先用 `browser` 工具**
- 做长文网页转写时，**先用 `browser` 拿正文；如果 `tabs.text` 已返回 `textPath`，直接把它当原文主文件，再分段处理**
- `msgcode browser ...` 主要用于：
  - 查 CLI 合同
  - 排障
  - 明确检查 root / instances / tabs 状态

先把 Patchright 当成唯一正式浏览器底座，不要使用 `agent-browser`。

## 快速分层

### L1 普通网页任务

适用：

- 打开网页
- 读取页面标题或正文
- 点击、输入、截图
- 正常网页任务执行

动作：

- 直接用 `browser` 工具
- 不要先降级成 `bash` + `msgcode browser ...`

### L2 长文网页 / 转写 / 存链接

适用：

- 把文章整理成 `.md`
- 需要保留图片链接、原文链接
- 用户明确要“完整正文”，不能只给摘要

动作：

1. 用 `browser` 打开并读取正文
2. 如果 `tabs.text` 已返回 `textPath`，直接复用它；只有没有 `textPath` 时，才手工落盘原文文件
3. 结果文件名必须按任务生成唯一文件名，不要反复覆盖同一个固定文件
4. 如果正文较长，必须用 `bash` 分段读取到结尾
5. 再生成目标 Markdown 文件
5. 用 `wc -l` 和 `tail` 做结尾校验后，再回复完成

### L3 排障 / 异常网页

适用：

- 抓到的正文明显过短
- 页面有折叠、懒加载、跳转、iframe、登录墙、推荐流干扰
- 需要确认 root / instances / tabs / `tabId`

动作：

- 读本 skill
- 优先检查 `instanceId` / `tabId` 是否真实有效
- 必要时用 `msgcode browser snapshot/text/eval` 查 DOM、正文长度和当前标签页状态

## 核心规则

- **浏览器任务默认优先走 `browser` 原生工具，不要先走 `bash` 包 CLI。**
- **只有当你需要排障、查状态、确认参数合同，才转向 `msgcode browser ...`。**
- **长文网页任务，不要把标题、摘要、单次预览或 snapshot 当成全文。**
- **长文网页任务，优先复用 `tabs.text` 返回的 `textPath`；没有 `textPath` 时，再手工落盘原文文件。**
- **长文网页任务，原文文件和结果文件都必须按任务生成唯一文件名，不要写死成同一个文件。**
- **没有看过文件尾部之前，不要宣称“已经转写完”。**
- **需要保留链接时，优先保留原始 URL，不要把链接改写成模糊描述。**
- 共享工作 Chrome 根目录信息时，先执行：
  - `msgcode browser root --ensure --json`
- 需要查看 roots / instances / tabs 时，显式调用对应子命令，不猜默认 instance / tab。
- `instances stop` 和 `tabs list` 不是无参命令，必须传真实 `instanceId`。
- `instanceId` 不是人工编号，必须来自真实返回值，通常来自 `instances launch --json`、`instances list --json`、`tabs open --json` 等结构化结果。
- `tabId` 不是人工编号，不是 1、2、3 这种顺序号。`tabId` 必须来自真实返回值，通常来自 `tabs open --json`、`tabs list --json`、`snapshot --json`、`text --json` 等结构化结果里的 `tabId`。
- 读取页面内容、截图、点击或执行脚本前，先确认当前真实 `tabId`。不要猜旧页签，更不要直接写死 `tabId=1`。
- 需要真实网页交互时，优先走正式 `browser` 工具；需要排障、查看状态或验证 CLI 合同时，再走本 skill。

## 长文网页主链

适用于“把网页完整整理成 Markdown / 保存图片链接 / 不允许只拿半篇”的任务。

1. 先确认当前打开的是正文页，而不是列表页、摘要页、相关推荐页或评论流。
2. 用 `browser` 读取正文，不要直接根据标题或短预览写结果。
3. 如果 `tabs.text` 已返回 `textPath`，直接把它当原文主文件；否则第一时间把正文落盘成原文文件。
4. 原文文件名和结果文件名都按任务生成唯一文件名，例如 `<slug>.raw.txt` 和 `<slug>.md`。
5. 如果文件较长，继续用 `bash` 分段读取，直到读到文件结尾。
6. 再生成目标 Markdown 文件。
6. 生成后校验原文和结果文件的末尾内容，确认没有半篇截断。

推荐命令：

```bash
RAW_FILE="<browser返回的textPath或你手工落盘的原文文件>"
OUT_FILE="<按任务生成的结果文件名>"

wc -l "$RAW_FILE"
sed -n '1,200p' "$RAW_FILE"
sed -n '201,400p' "$RAW_FILE"
tail -n 40 "$RAW_FILE"
rg -o 'https?://[^ )]+' "$RAW_FILE"
wc -l "$OUT_FILE"
tail -n 20 "$OUT_FILE"
```

如果文章更长，就继续向后分段：

```bash
sed -n '401,600p' "$RAW_FILE"
sed -n '601,800p' "$RAW_FILE"
```

只有确认已经读到结尾，才允许回复“已完成”。

## 常见坑

- 把 `browser` 返回的标题、URL、短预览当成完整正文
- 只看 `snapshot`，不核对真实正文文本
- 页面还没展开“阅读全文 / Read more / 展开剩余内容”
- 页面懒加载，没滚动或没触发正文渲染就开始写
- 跳进评论区、推荐流、侧栏导航，误把非正文内容混进结果
- 复用旧 `tabId` / 旧 `instanceId`
- 写完文件后不看末尾，直接说“已经整理完成”

## 读不到完整正文时怎么做

优先按这个顺序处理：

1. 确认当前 `tabId` 是真实有效的
2. 重新读取正文，不要只看上一次结果
3. 用 `snapshot` 检查页面是否有“展开 / 更多 / 继续阅读”按钮
4. 必要时先点击展开或滚动，再重新读取正文
5. 用 `eval` 或 `text` 确认正文长度是否明显异常
6. 仍然不完整时，再进入 CLI 排障路径

不要直接把“不完整的一次读取结果”当成最终真相源。

## 常用模板

```bash
msgcode browser root --ensure --json
msgcode browser profiles list --json
msgcode browser instances list --json
msgcode browser instances launch --mode headed --root-name work-default --json
msgcode browser tabs open --url https://example.com --json
msgcode browser tabs list --instance-id <real-instance-id> --json
msgcode browser instances stop --instance-id <real-instance-id> --json
msgcode browser snapshot --tab-id <real-tab-id> --compact --json
msgcode browser text --tab-id <real-tab-id> --json
msgcode browser eval --tab-id <real-tab-id> --expression 'document.body.innerText.length' --json
msgcode browser action --tab-id <real-tab-id> --kind click --ref '{"role":"link","name":"More info","index":0}' --json
```

正确示例：

1. 先执行 `instances launch --json` 或 `tabs open --json`
2. 从返回 JSON 中读取真实 `instanceId` 和 `tabId`
3. `tabs list` / `instances stop` 复用真实 `instanceId`
4. `snapshot`、`text`、`action`、`eval` 复用真实 `tabId`

错误示例：

- `tabs list --json`
- `instances stop --json`
- `tabs list --instance-id 1`
- `snapshot --tab-id 1`
- `text --tab-id 1`
- `action --tab-id 1 --kind click ...`
- `instances stop --instance-id 1`
- 复用上一轮已经失效的旧 `tabId`
- 猜测一个旧 `instanceId`

## 参数速查

- `tabs.action` 必填 `kind`（`click` / `type` / `press`）
- `ref` 为 JSON：`{"role":"...","name":"...","index":N}`
- `kind=type` 时带 `text`
- `kind=press` 时带 `key`（如 `Enter` / `Tab` / `Escape`）
- `tabs.snapshot` 可带 `--interactive`
- `instances.launch` 可带 `--port` 指定调试端口（默认 `9222`）

## 验证与排障

推荐顺序：

1. `root --ensure`
2. `profiles list`
3. `instances list` / `instances launch`
4. `tabs open`
5. `tabs list`
6. `text` / `snapshot`
7. `action` / `eval`

需要排障时，先看 root、instances、tabs 的结构化 JSON，不要直接猜当前浏览器状态，不要猜 `tabId`。

长文网页任务的完成前检查：

1. 原文文件是否已经落盘
   - 如果 browser 已返回 `textPath`，优先检查这个路径
2. 是否已经读到文件尾部
3. 结果文件末尾是否覆盖到原文结尾
4. 图片链接 / 原文链接是否保留
5. 若页面存在折叠内容，是否已经展开后重新读取

## 非目标

- 不要把普通网页任务默认降级成 `bash` + `msgcode browser ...`
- 不要只凭一次短预览就整理长文
- 不要先猜一个 CLI 命令再去试错
- 不要使用 `agent-browser` 作为正式浏览器通道
