# msgcode 2.1（Design Notes）

> 目标：在不污染主链路（iMessage 收发 + 路由 + tmux 会话）的前提下，把“常驻能力”补齐：**Jobs/定时** + **机器可解析诊断**。

## 目录

```
AIDOCS/msgcode-2.1/
├── README.md              # 本目录索引
└── job_spec_v2.1.md       # Jobs（定时/周期任务）设计草案 v2.1
```

## 约束（2.1 总原则）
- JSON-first：所有状态/诊断都必须可机器解析（便于 agent/脚本自动解读）。
- 最小权限：禁止任意 shell 执行；只允许“往 tmux 会话送消息”这种可控副作用。
- 可观测：每个 job 的 nextRun/lastRun/lastError 都落盘，可被 `probe/doctor` 读取。

