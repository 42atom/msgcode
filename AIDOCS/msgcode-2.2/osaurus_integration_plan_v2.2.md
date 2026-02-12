# osaurus 参考笔记（v2.2）

> 定位：仅作为 **参考与对照**，不纳入 msgcode 2.2 的“必须交付”。  
> 结论：msgcode 的人格/skills/定时任务/MCP 总线仍由 msgcode 自己实现；osaurus 的价值主要在“工具 contract + 权限模型 + 插件安装链路”的借鉴。

---

## 0) 我们从 osaurus 学什么（只拿精华）

### 1) MCP 风格的最小工具总线（HTTP）
- `GET /mcp/tools`：列出工具（name/description/inputSchema）
- `POST /mcp/call`：调用工具（name + arguments），返回 `{ isError, content[] }`
- schema 校验：在 call 前做 JSON Schema 校验，失败也返回 200（但 `isError=true`）

代码位置（对照用）：
- `/mcp/tools` 与 `/mcp/call`：`/Users/admin/GitProjects/GithubDown/osaurus/Packages/OsaurusCore/Networking/HTTPHandler.swift:1120`

### 2) 权限模型：requirements + permission_policy
- 每个工具声明：
  - `requirements`: 系统权限（automation/accessibility/disk…）+ 自定义 grant
  - `permission_policy`: `deny|ask|auto`
- 执行前统一门禁：缺系统权限直接失败；policy=ask 弹窗确认；policy=deny 拒绝；policy=auto 自动放行（可落盘 grant）

代码位置（对照用）：
- ToolRegistry：`/Users/admin/GitProjects/GithubDown/osaurus/Packages/OsaurusCore/Tools/ToolRegistry.swift:1`

---

## 1) 插件安装链路（供应链可信）
osaurus 的插件体系值得借鉴的点：
- C ABI + JSON manifest/invoke：语言无关、工具描述可审计
- requirements + permission_policy：权限声明可审计
- 安装链路校验（签名/sha256）+ receipt（安装收据）

文档位置（对照用）：
- `PLUGIN_AUTHORING.md`：`/Users/admin/GitProjects/GithubDown/osaurus/docs/PLUGIN_AUTHORING.md:1`

---

## 2) 对 msgcode 的落地结论（2.2）
- 不复刻 osaurus 的 personas/schedules/agents UI：msgcode 自己实现（workspace 级真相源）
- MCP 总线我们自己做：复制它的 **contract**，但把“高风险确认”放回 msgcode（手机端）
- osaurus 保留为参考/对照：需要时借鉴它的 tool schema、权限声明、安装收据结构
