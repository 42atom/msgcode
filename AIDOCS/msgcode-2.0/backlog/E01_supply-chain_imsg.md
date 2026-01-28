# E01: imsg 供应链（开源核验 + 源码构建 + 固定版本）

## Goal
把 `imsg` 变成“可审计、可复现、可回滚”的高权限依赖：不再直接信任 release zip。

## Scope
- 固定版本策略：tag/commit pin（例如 `v0.4.0` 或我们选定的稳定 tag）。
- 源码构建流水线：本机可重复构建出 `imsg` 二进制。
- 产物记录：输出二进制的 hash（以及可选的 codesign/notary 策略）。

## Non-goals
- 不在 2.0 里重写 `imsg` 全量功能。

## Tasks
- [ ] 确认 upstream repo + license + tags（记录到 docs/notes）
- [ ] 选定 pin：`tag` 或 `commit SHA`
- [ ] 写一条“源码构建命令”并在干净环境验证（Swift Package）
- [ ] 产物校验：记录 `shasum -a 256` 到 release notes
- [ ] 安装策略：`PATH` 指向我们构建的产物（不再依赖 brew release zip）
- [ ] 回滚策略：保留上一版二进制与 pin

## Acceptance
- 任意新机器：按步骤可以构建出一致版本（hash 记录可对比）。

## Risks
- Swift 工具链/系统版本差异导致不可复现 → 最少做到“固定 macOS/固定 Xcode/固定 tag”。

