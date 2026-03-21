# msgcode bootstrap

只分两层：

1. 默认主链：托管 Bash
2. 可选增强：agent 工具集

不要把两层混成一层。

## 默认主链

目标：让 `bash` 工具只依赖同一份托管 Bash。

安装：

```bash
sh bootstrap/bootstrap.sh
```

验证：

```bash
sh bootstrap/doctor-managed-bash.sh
```

正式 shell 合同只认：

- `/opt/homebrew/bin/bash`
- `/usr/local/bin/bash`

不认：

- 用户登录 shell
- `zsh`
- 系统 `/bin/bash` 3.2
- `/bin/sh`

## 可选增强

目标：补一批对 agent 直接有增益的终端工具，但不改变默认 shell 合同。

安装：

```bash
sh bootstrap/bootstrap-agent-pack.sh
```

验证：

```bash
sh bootstrap/doctor-agent-pack.sh
```

当前清单真相源：

- `bootstrap/Brewfile.agent`

这层是可选增强，不是默认主链。

## Appliance 骨架

这层服务本地 appliance，不再碰 `brew` / `npm install`。

入口：

```bash
sh bootstrap/install-appliance.sh --bundle-root <bundle> --install-root <target>
sh bootstrap/first-run-init.sh --install-root <target> --workspace acme/ops
sh bootstrap/upgrade-appliance.sh --bundle-root <bundle> --install-root <target>
sh bootstrap/doctor-appliance.sh --install-root <target>
sh bootstrap/rollback-appliance.sh --install-root <target>
```

约束：

- `install-appliance.sh` 只接收已经组装好的 `bundle-root/runtime`
- `first-run-init.sh` 只负责调用 `msgcode init`
- `upgrade-appliance.sh` 只替换安装目录下的 `runtime/`
- 如存在 `bundle-root/appliance.manifest`，`install/upgrade` 会优先按 manifest 读运行时路径与 launcher 路径
- `doctor-appliance.sh` 会检查 manifest 版本、app 版本、runtime 和 launcher 是否齐全
- `rollback-appliance.sh` 只在本地保留了上一版 `runtime.prev + appliance.manifest.prev` 时生效

再补一条正式交付口径：

- 对 appliance / App 而言，基础运行依赖必须只有两种来源：
  - 随包携带
  - 预安装软件必须清单
- install / doctor 必须前置检查这些缺口。
- 不允许再把基础依赖缺失留到运行时，最后表现成“bash 不可用”“AI 无法访问本地设备”这类伪能力问题。

当前按仓库事实已明确的预安装软件必须清单：

- 参考真相源：
  - `/Users/admin/GitProjects/msgcode/docs/plan/rf0002.rvw.product.appliance-required-preinstall-software.md`
- 当前 install / doctor 第一刀已前置检查：
  - 托管 Bash
  - `zstd`

- Core Appliance：
  - 托管 Bash（若未随包）
  - `zstd`（若未随包且继续使用当前 `.wpkg` 安装主链）
- Optional Packs：
  - Browser pack -> `Google Chrome / Chromium`
  - Desktop pack -> `ghost-os`
  - tmux coding pack -> `tmux`

不进入这份清单的：

- 只服务开发者体验的增强工具
- 尚未完成产品边界收口的本地模型后端
