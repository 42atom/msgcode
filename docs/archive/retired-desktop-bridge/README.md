# retired-desktop-bridge

> 已退役的自研 Desktop Bridge 版本化归档。现役桌面能力面已经切到 `ghost_*`；本目录只保留旧 bridge 的源码、协议、脚本、recipe 与历史发布资料，供追溯、对照和手工恢复使用。

## 内容

```text
docs/archive/retired-desktop-bridge/
├── README.md
├── RELEASING.md
├── mac/
├── docs/desktop/
├── scripts/desktop/
└── recipes/desktop/
```

## 使用原则

1. 不在这里继续开发新功能。
2. 不把 archive 里的脚本重新挂回现役 package/script 入口。
3. 若需要核对旧 bridge 行为，直接在 archive 内 grep / 手动执行，不要恢复双主链。
4. 当前桌面能力以 `ghost_*` 和 `ghost-mcp` skill 为准。
