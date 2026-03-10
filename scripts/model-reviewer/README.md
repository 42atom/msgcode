# model-reviewer

串行对比多个本地模型在同一图片任务上的输出表现。

## 目标

1. 固定同一张图片、同一条 prompt、同一组请求参数。
2. 逐个加载模型、执行请求、卸载模型，避免并发占满内存。
3. 输出 `content`、`reasoning_content`、`finish_reason`、token、耗时与错误。

默认行为：

1. 尊重用户当前在 LM Studio 中手动加载和配置好的模型。
2. 不主动 `load`，也不主动 `unload`。
3. 只有显式传 `--auto-load` 时，脚本才接管模型的加载与卸载。

## 运行

```bash
bun scripts/model-reviewer/main.ts --image /absolute/path/to/image.png
```

如果需要由脚本自己管理模型生命周期：

```bash
bun scripts/model-reviewer/main.ts --image /absolute/path/to/image.png --auto-load
```

## 输出

默认写入：

```text
AIDOCS/tmp/model-reviewer-<timestamp>/
```

包含：

1. `meta.json`
2. `summary.json`
3. `<model>.response.json`
4. `<model>.content.txt`
5. `<model>.reasoning.txt`
