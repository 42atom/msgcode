# prompts

系统提示词目录。这里的文件是智能体行为口径的可调试真相源。

## 目录结构

```text
prompts/
├── README.md
├── agents-prompt.md
└── lmstudio-system.md (compat)
```

## 文件说明

- `agents-prompt.md`：主链基础系统提示词。运行时默认读取该文件，可通过 `AGENT_SYSTEM_PROMPT_FILE` 覆盖。
- `lmstudio-system.md`：兼容文件，仅用于历史 `LMSTUDIO_SYSTEM_PROMPT_FILE` 配置。

## 设计约束

- 优先提示词注入约束行为，不在业务链路增加“替模型决策”的特殊分支。
- 变更提示词后可直接重启服务生效，适用于快速调参与回归验证。
