# prompts

系统提示词目录。这里的文件是智能体行为口径的可调试真相源。

## 目录结构

```text
prompts/
├── README.md
└── lmstudio-system.md
```

## 文件说明

- `lmstudio-system.md`：LM Studio 主链基础系统提示词。运行时通过 `LMSTUDIO_SYSTEM_PROMPT_FILE` 引用；未配置时默认读取此文件。

## 设计约束

- 优先提示词注入约束行为，不在业务链路增加“替模型决策”的特殊分支。
- 变更提示词后可直接重启服务生效，适用于快速调参与回归验证。
