---
name: vision-index
description: This skill should be used when the model needs detailed image understanding beyond the system preview summary, and needs a provider-neutral capability index.
---

# vision-index skill

## 能力

本 skill 是详细视觉能力索引，不是系统内建视觉控制面。

- 系统层只负责图片收取、落盘和预览摘要。
- 需要进一步读图时，由模型自己决定走哪条视觉能力。
- 本 skill 只负责告诉模型：什么时候优先原生看图、什么时候读 provider skill、以及每类能力该去看哪份说明书。

## 何时使用

在以下场景读取并使用本 skill：

- 用户要你读图中文字
- 用户要你抄表格、票据、报错截图、UI 细节
- 用户要你抽取图片里的结构化信息
- 系统已经给了 `[图片摘要]`，但用户继续追问具体细节

## 使用方式

先读 `~/.config/msgcode/skills/index.json`，再读本 skill。真正执行时，以 provider-specific skill 里的真实调用合同为准，不要假设所有 skill 都统一走 `main.sh` wrapper。

不要调用 `vision-index/main.sh` 这类额外壳；`vision-index` 自身就是说明书，不是执行入口。

## 核心规则

- 不要把详细视觉任务再塞回系统内部 `vision` 预览摘要能力。
- `[图片摘要]` 只是预览，不是最终真相。
- 详细视觉由模型自己决定；系统不替你选 provider，不替你做 OCR 裁决。
- 如果当前模型原生支持图片输入，优先直接继续看图，不额外调本地脚本或 MCP。
- 如果当前模型不能原生看图，再根据环境选择 `local-vision-lmstudio`。
- 失败后先和用户沟通限制、重试方案或补充信息，不要要求系统替你加 recover 层。

## 供应商选择顺序

### 1. 当前模型原生支持图片输入

优先直接使用当前模型的原生看图能力：

- 不额外调用 provider wrapper
- 直接基于当前附件路径、附件信息和用户问题继续分析
- 适合 GPT 等原生多模态模型

### 2. 需要走本地 LM Studio 视觉模型

先读：

- `~/.config/msgcode/skills/local-vision-lmstudio/SKILL.md`

再按那份说明书里的真实调用合同执行。重点是：优先用该 skill 自带的 `main.sh` 或 `scripts/analyze_image.py`，不要再去外部 skills 目录找实现。

## 失败处理

- 如果 provider 返回崩溃、空结果或识别不完整，先把现象如实告诉用户。
- 可以自行决定是否换一个更明确的提示词重试一次。
- 可以建议用户重新发更清晰的图、原图、裁剪图，或把目标区域单独发出来。
- 不要把失败自动归因成“图片太糊”；先基于结果和证据说明限制。

## 与系统边界

- 系统：收图、落盘、预览摘要、附件路径
- 模型：选择视觉 provider、编写详细提示词、决定是否重试、与用户沟通限制
- skill：提供调用说明书，不提供控制层
