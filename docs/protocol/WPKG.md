---
owner: user
assignee: codex
reviewer: user
why: wpkg 需要先成为一种稳定、极薄的能力包协议，后续主界面、agent 和生态扩展才有共同语言
scope: 只定义 wpkg 的最小包结构、manifest 字段、安装后注册表与消费边界；不包含安装器、支付或市场实现
risk: medium
accept: 存在一份可执行协议，说明 wpkg 是什么、安装后写什么、谁来读这些真相源
links:
  - /Users/admin/GitProjects/msgcode/issues/tk0290.pss.product.p1.wpkg-installable-capability-pack-baseline.md
  - /Users/admin/GitProjects/msgcode/docs/plan/pl0290.pss.product.wpkg-installable-capability-pack-baseline.md
  - /Users/admin/GitProjects/msgcode/docs/plan/pl0273.tdo.product.local-sidecar-sites-and-skill-result-visualization.md
  - /Users/admin/GitProjects/msgcode/src/cli/appliance.ts
---

# WPKG

## 结论

`wpkg` 第一版只是：

- 一个带 `manifest.json` 的 zip 包

不要把它做成复杂包管理系统。

目标只有三个：

1. 可安装
2. 主界面可见
3. agent 可发现

## 包结构

最小结构：

```text
<pack-id>.wpkg
├── manifest.json
├── web/
├── skills/
└── assets/
```

说明：

- `manifest.json`
  - 包元信息真相源
- `web/`
  - sidecar 站点或 Web 资源
- `skills/`
  - 供 agent 发现和使用的 skill
- `assets/`
  - 模板、图片、静态资源等

第一版不支持：

1. `postinstall`
2. 自定义 shell 脚本
3. 自定义后台进程
4. 远程下载依赖

## Manifest

`manifest.json` 第一版最小字段：

```json
{
  "id": "company-finance",
  "name": "公司财务包",
  "version": "0.1.0",
  "author": "Acme Labs",
  "commercial": true,
  "licenseType": "paid",
  "sites": [
    {
      "id": "finance",
      "title": "财税站",
      "entry": "web/index.html",
      "kind": "sidecar",
      "description": "财税主题站"
    }
  ],
  "skills": [
    "skills/finance-index/SKILL.md"
  ],
  "requires": [
    "memory"
  ]
}
```

字段说明：

### `id`

- 稳定包 ID
- 只允许小写字母、数字、连字符

### `name`

- 面向人类显示名

### `version`

- 包版本

### `author`

- 作者或发布方

### `commercial`

- 是否商业包
- 只留位，不承载支付实现

### `licenseType`

- 例如：`free` / `paid` / `private`
- 只留位，不承载授权实现

### `sites`

- 这个包带来的站点入口

### `skills`

- 这个包带来的 skill 路径

### `requires`

- 对宿主能力的依赖声明
- 例如：`memory`

## 安装后真相源

第一版安装后统一写两份注册表：

1. `<workspace>/.msgcode/packs.json`
2. `<workspace>/.msgcode/sites.json`

### packs.json

建议形态：

```json
{
  "builtin": [],
  "user": [
    {
      "id": "company-finance",
      "name": "公司财务包",
      "version": "0.1.0",
      "author": "Acme Labs",
      "enabled": true,
      "commercial": true,
      "licenseType": "paid",
      "sourcePath": ".msgcode/packs/user/company-finance"
    }
  ]
}
```

用途：

- 主界面显示已安装 packs
- 未来壳读取 pack 状态

主界面展示时直接按这两组读取：

1. `builtin`
2. `user`

但 `hall.packs` 当前只暴露最小显示字段：

1. `id`
2. `name`
3. `version`
4. `enabled`

不要把注册表里的：

- `sourcePath`
- `commercial`
- `licenseType`

直接带进主界面。

### sites.json

建议沿用现有 `appliance sites` 合同：

```json
{
  "sites": [
    {
      "id": "finance",
      "title": "财税站",
      "entry": ".msgcode/packs/user/company-finance/web/index.html",
      "kind": "sidecar",
      "description": "财税主题站",
      "packId": "company-finance"
    }
  ]
}
```

用途：

- 主界面显示站点入口
- 壳打开对应站点

当前最小安装切片已落地：

- `msgcode appliance install-pack --workspace <workspace> --file <pack.wpkg>`

它会：

1. 解压 `.wpkg`
2. 校验 `manifest.json`
3. 落到 `<workspace>/.msgcode/packs/user/<pack-id>/`
4. 更新 `packs.json`
5. 更新 `sites.json`

当前明确不做：

- 升级
- 卸载
- 签名
- 市场/支付

## Agent 发现

第一版不让 agent 直接扫 `.wpkg` 包目录。

安装时应把：

1. pack 的 skill 路径
2. pack 的基础说明
3. pack 的能力范围

写入宿主可读的注册表或索引。

原则：

- 包安装时注册
- agent 运行时读取注册结果
- 不在运行时猜目录

## 主界面边界

主界面只负责：

1. 看见有哪些 pack
2. 看见 pack 带来的站点入口
3. 打开站点

主界面不承担：

1. pack 业务建模
2. pack 内部资源解释
3. 把 sidecar 主题面重新吞回主 UI

## 留口但不实现

这几个字段和能力要留口，但当前不做实现：

1. 商业包
2. 授权
3. 开发者收入
4. 市场分发

当前只要求协议能承载这些信息，不要求宿主处理它们。
