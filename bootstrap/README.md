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

## Appliance 最小安装主链

这层服务本地 appliance，不再碰 `brew` / `npm install`。

首次安装只认这一条线：

1. 机器检查
2. 预装检查
3. `install-appliance.sh`
4. `doctor-appliance.sh`
5. 首次启动

不要把升级、回滚、可选能力包混进这条线。

### 1. 机器检查

这一步不新增脚本，只确认主链输入已经齐：

- 输入：
  - 一个已经组装好的 `bundle-root`
  - 目标安装目录 `install-root`
  - 可选 workspace 标识或路径，供首次启动时传给 `msgcode init --workspace`
- 输出：
  - 明确后续只走 appliance 主链，不回退到开发者 `bootstrap.sh`
  - 明确 `bundle-root`、`install-root`、`workspace` 三个输入值
- 失败语义：
  - 如果机器上还在讨论 `brew` / `npm install`，说明走错主链，先停
  - 如果 `bundle-root`、`install-root`、`workspace` 说不清，先停，不进入安装

### 2. 预装检查

这一步没有第二个 doctor，也不单独发明安装器入口。正式口径只有一份：

- 真相源：
  - `bootstrap/lib-appliance-preinstall.sh`
- 消费者：
  - `install-appliance.sh`
  - `doctor-appliance.sh`

当前检查项：

- 托管 Bash
- `zstd`

输入、输出、失败语义：

- 输入：
  - 当前机器环境
  - 可选覆盖环境变量：
    - `MSGCODE_MANAGED_BASH_CANDIDATES`
    - `MSGCODE_ZSTD_CANDIDATES`
- 输出：
  - 成功时打印 `[preinstall] ...: ok (...)`
- 失败语义：
  - 任一缺失即 fail-closed
  - 错误会明确指出缺的依赖与候选路径
  - 结尾会指向预装清单真相源：
    - `/Users/admin/GitProjects/msgcode/docs/plan/rf0002.rvw.product.appliance-required-preinstall-software.md`

### 3. install-appliance

命令：

```bash
sh bootstrap/install-appliance.sh --bundle-root <bundle> --install-root <target>
```

输入、输出、失败语义：

- 输入：
  - `--bundle-root <path>`
  - `--install-root <path>`
  - `bundle-root/runtime`
  - 可选 `bundle-root/appliance.manifest`
- 输出：
  - 先跑同一份预装检查
  - 把 `runtime/` 复制到 `install-root/`
  - 写入启动入口 `install-root/bin/msgcode`
  - 写入 `install-root/appliance.manifest`
- 失败语义：
  - 缺参数、未知参数：退出码 `2`
  - 缺 `bundle-root/runtime`：退出码 `2`
  - `install-root` 已包含 `runtime/`：退出码 `2`，并明确提示改走 `upgrade-appliance.sh`

补充约束：

- `install-appliance.sh` 只接收已经组装好的 `bundle-root/runtime`
- 如存在 `bundle-root/appliance.manifest`，优先按 manifest 读取运行时路径与 launcher 路径

### 4. doctor-appliance

命令：

```bash
sh bootstrap/doctor-appliance.sh --install-root <target>
```

输入、输出、失败语义：

- 输入：
  - `--install-root <path>`
- 输出：
  - 先跑同一份预装检查
  - 校验安装目录内的：
    - `appliance.manifest`
    - manifest version
    - app version
    - `runtime/`
    - launcher
    - runtime entry
  - 全部通过时打印：
    - `Appliance doctor 通过：<install-root> (version=<app-version>)`
- 失败语义：
  - 缺参数、未知参数：退出码 `2`
  - 任一预装依赖缺失：直接失败
  - manifest/version/app version/runtime/launcher/runtime entry 任一缺失：退出码 `2`

### 5. 首次启动

首次启动不另造逻辑，只桥接到安装后的 launcher。

命令：

```bash
sh bootstrap/first-run-init.sh --install-root <target> --workspace acme/ops
```

输入、输出、失败语义：

- 输入：
  - `--install-root <path>`
  - `--workspace <labelOrPath>` 可选
- 输出：
  - 找到 `install-root/bin/msgcode`
  - 执行：
    - `msgcode init`
    - 或 `msgcode init --workspace ...`
  - `msgcode init` 负责生成首次真相源，包括：
    - `~/.config/msgcode/.env`
    - `~/.config/msgcode/souls/default/SOUL.md`
    - `~/.config/msgcode/souls/active.json`
    - `<workspace>/.msgcode/`
    - `<workspace>/memory/`
    - `<workspace>/AIDOCS/reports/`
- 失败语义：
  - 缺参数、未知参数：退出码 `2`
  - 缺 launcher：退出码 `2`
  - `msgcode init` 自身失败时，错误原样透传，不另包一层系统代答

初始化完成后，后续日常启动直接使用：

```bash
<install-root>/bin/msgcode ...
```

### 相关但不属于首次安装主链

这些入口保留，但不混入上面的五步：

```bash
sh bootstrap/upgrade-appliance.sh --bundle-root <bundle> --install-root <target>
sh bootstrap/rollback-appliance.sh --install-root <target>
```

约束：

- `upgrade-appliance.sh` 只替换安装目录下的 `runtime/`
- `rollback-appliance.sh` 只在本地保留了上一版 `runtime.prev + appliance.manifest.prev` 时生效

再补一条正式交付口径：

- 对 appliance / App 而言，基础运行依赖必须只有两种来源：
  - 随包携带
  - 预安装软件必须清单
- install / doctor 必须前置检查这些缺口
- 不允许再把基础依赖缺失留到运行时，最后表现成“bash 不可用”“AI 无法访问本地设备”这类伪能力问题

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
