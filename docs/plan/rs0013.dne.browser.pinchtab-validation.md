# PinchTab 验证记录（260306）

## 目标

验证三件事：

1. `pinchtab` 在当前机器上的实际安装路径是否顺畅
2. 是否适合作为 `msgcode` 的主浏览器底座依赖
3. 不写任何正式集成代码前，能否先用真实浏览器链路完成一条公开网站任务

## 验证范围

- 安装方式：npm 包 `pinchtab`
- 运行方式：本机命令行 + PinchTab HTTP/CLI
- 测试任务：公开网站上的 `open -> snapshot/text -> action` 闭环
- 非范围：Gmail 登录态、人机接力登录、msgcode 内部 browser tool 集成

## 待记录

### 安装

- 命令：
  - `npm view pinchtab version dist-tags.latest description --json`
  - `npm install pinchtab@0.7.7`
  - `npx pinchtab --help`
- 结果：
  - npm registry 可访问，当前 latest 为 `0.7.7`
  - 安装后 `package.json` 新增依赖：`"pinchtab": "^0.7.7"`
  - 安装脚本自动下载二进制到：`~/.pinchtab/bin/0.7.7/pinchtab-darwin-arm64`
  - `npx pinchtab --help` 可正常返回 CLI 帮助，证明本机可执行链路成立

### 实测任务

- 站点：
  - `https://example.com`
- 任务：
  - 假定 agent 收到任务：“打开公开页面，识别可交互元素，点击唯一链接，并确认已跳转到目标页”
- 关键命令：
  - 启动服务：
    - `BRIDGE_TOKEN=msgcode-test npx pinchtab`
  - 验活：
    - `PINCHTAB_TOKEN=msgcode-test npx pinchtab health`
  - 创建临时实例（headless）：
    - `curl -X POST http://127.0.0.1:9867/instances/launch -H 'Authorization: Bearer msgcode-test' -H 'Content-Type: application/json' -d '{"mode":"headless"}'`
  - 显式打开 tab：
    - `curl -X POST http://127.0.0.1:9867/instances/inst_0aa47905/tabs/open -H 'Authorization: Bearer msgcode-test' -H 'Content-Type: application/json' -d '{"url":"https://example.com"}'`
  - 读交互快照：
    - `curl 'http://127.0.0.1:9867/tabs/tab_8d56ba79/snapshot?filter=interactive&format=compact' -H 'Authorization: Bearer msgcode-test'`
  - 点击唯一链接：
    - `curl -X POST http://127.0.0.1:9867/tabs/tab_8d56ba79/action -H 'Authorization: Bearer msgcode-test' -H 'Content-Type: application/json' -d '{"kind":"click","ref":"e0"}'`
  - 验证跳转：
    - `curl -X POST http://127.0.0.1:9867/tabs/tab_8d56ba79/evaluate -H 'Authorization: Bearer msgcode-test' -H 'Content-Type: application/json' -d '{"expression":"location.href"}'`
    - `curl -X POST http://127.0.0.1:9867/tabs/tab_8d56ba79/evaluate -H 'Authorization: Bearer msgcode-test' -H 'Content-Type: application/json' -d '{"expression":"document.title"}'`
  - headed 实例验证：
    - `curl -X POST http://127.0.0.1:9867/instances/launch -H 'Authorization: Bearer msgcode-test' -H 'Content-Type: application/json' -d '{"mode":"headed"}'`
    - `curl http://127.0.0.1:9870/health -H 'Authorization: Bearer msgcode-test'`
- 结果：
  - 服务可正常启动，dashboard 模式监听在 `http://localhost:9867`
  - headless 实例可正常拉起并暴露健康检查
  - headed 实例也能正常拉起并暴露健康检查
  - 用“显式创建 tab -> snapshot -> click -> evaluate”这条链路，任务可真实跑通
  - 点击后的目标页校验成功：
    - `location.href = https://www.iana.org/help/example-domains`
    - `document.title = Example Domains`

### 坑点

1. `pinchtab profiles` 在无 profile 场景会输出 `[]`，但 CLI 还会打印 JSON 反序列化 warning：
   - `warning: error unmarshaling response: json: cannot unmarshal array into Go value of type map[string]interface {}`
2. dashboard/orchestrator 模式下，CLI `nav` / `quick` 不会自动起实例：
   - 直接执行会报 `no running instances — launch one from the Profiles tab`
   - 这说明 `pinchtab` 的“简单 CLI”更接近单实例/已连接 profile 的使用方式；若处于 dashboard/orchestrator 模式，应该先显式起实例或使用 `connect` 获取实例 URL
3. 实例启动后的“默认 tab / 当前 tab”语义不稳：
   - `nav` 返回的 `tabId` 为 `tab_ea3aaa20`
   - 但 `GET /instances/{id}/tabs` 返回的是另一套 tab ID
   - 随后 `snap` 会报 `tab tab_ea3aaa20 not found`
   - 因此，问题不只是“我们姿势不对”，CLI 在当前版本对 tab 语义的封装也确实不够稳
4. `text` 在跳转到 IANA 页后失败：
   - `text extract: exception "Uncaught"... Cannot read properties of null (reading 'cloneNode')`
   - 但 `evaluate` 已证明页面实际跳转成功
5. 结论：**当前版本更适合直接对接 HTTP API，而不是包 CLI 当主集成层**
6. 2026-03-06 新增验证：**不能直接拿当前真实 Chrome 默认数据目录做 CDP 测试**
   - 本机已让 Chrome 以 `--remote-debugging-port=9222 --user-data-dir=/Users/admin/Library/Application Support/Google/Chrome --profile-directory=Profile 1` 启动
   - 当前前台页已确认是 `https://mail.google.com/mail/u/0/#inbox`
   - 但 `http://127.0.0.1:9222/json/version` 仍持续 `Connection refused`
   - 结合 Chrome 官方文档（2025-03-17）：Chrome 136+ 不再尊重默认真实数据目录上的 `--remote-debugging-port`
   - 结论：**当前已登录的真实 Chrome 不能按这条路直接变成 PinchTab/CDP 可控目标**

### 对 msgcode 的影响

1. `pinchtab` 可作为主浏览器底座依赖，安装可通过 npm 固化到项目依赖中。
2. `msgcode` 集成时应优先走 PinchTab HTTP API，不应简单透传 `pinchtab nav/snap/click` CLI。
3. 为了规避 tab 语义不稳，集成层建议默认采用：
   - 先启动/连接实例
   - 显式 `tabs/open`
   - 使用返回的可用 `tabId`
   - 再执行 `snapshot / action / text / evaluate`
4. `headed` 与 `headless` 双模式都已实测可起，这支持后续的人机接力登录方案。
5. 若用户要求“直接复用当前已登录 Chrome”，PinchTab/CDP 路线会被 Chrome 136+ 的安全策略卡住；这类场景若不想重新登录，应优先考虑桌面自动化（Desktop Bridge）而不是 PinchTab。
