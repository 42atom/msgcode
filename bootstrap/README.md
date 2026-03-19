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
