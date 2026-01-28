# E07: 打包与运行方式（launchd/配置/升级）

## Goal
把运行方式从“手动 npm start”升级成“可后台稳定运行、可升级、可查看状态”。

## Scope
- launchd plist（自动启动/崩溃重启）
- 配置路径规范（`~/.config/msgcode/.env` + state 文件）
- 升级流程（含 imsg 产物升级/回滚）

## Tasks
- [ ] 定义标准目录结构（config/log/state/bin）
- [ ] 生成/安装 launchd 配置（含日志路径）
- [ ] 写升级/回滚 SOP（2.0 级别）

## Acceptance
- 重启机器后自动恢复运行；崩溃可自启；升级可回滚。

