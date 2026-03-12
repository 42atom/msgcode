# retired-imsg-runtime 归档说明

## 目的

本目录保存 2026-03-12 从正式主链退场的 legacy `imsg` 运行时最小快照。

它的职责只有两个：

1. 提供**版本化、可审查**的退役证据
2. 为需要追溯历史行为的 review / rollback 提供最小源码快照

## 内容

- `src/imsg/`
  - `adapter.ts`
  - `rpc-client.ts`
  - `types.ts`
- `test/`
  - `imsg.adapter.archived.ts`
  - `commands.startup-guard.archived.ts`
- `vendor/imsg/v0.4.0/imsg`
  - legacy 二进制快照

## 边界

这些文件已经退出正式主链：

- 不允许再被 `src/` 现役代码 import
- 不允许再作为默认 transport/runtime 入口
- 不作为新功能开发的基础

## 历史说明

最初 sunset 迁移先把这些文件放进了本地 `.trash/2026-03-12-imsg-sunset/`，用于快速从主树拆除运行时依赖。  
但 `.trash/` 不进 Git，不能充当长期真相源。  
因此本目录补上版本化 archive，作为正式可审查记录。
