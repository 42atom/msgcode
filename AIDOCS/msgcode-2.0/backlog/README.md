# msgcode 2.0 Backlog（Epic 拆分）

## 结构
```
AIDOCS/msgcode-2.0/
└── backlog/
    ├── README.md
    ├── E01_supply-chain_imsg.md
    ├── E02_imessage_provider_rpc.md
    ├── E03_receive_pipeline_lastseen.md
    ├── E04_send_pipeline_unification.md
    ├── E05_observability_probe_health.md
    ├── E06_tests_simulation.md
    └── E07_packaging_launchd.md

AIDOCS/msgcode-2.0/
└── epics/
    ├── E08_control_plane_newchat.md
    ├── E09_public_artifacts_and_tunnel.md
    └── E10_scheduler_jobs_push.md
    └── E11_capability_api_skills.md
```

## 依赖关系（粗粒度）
- E01 是所有引入 `imsg` 的前置（方案 B 必须；方案 A 可选）。
- E03/E04 是 2.0 的“稳定性基建”。
- E05/E06/E07 是“可运维/可发布”的闭环。
- E08/E09/E10 是“2.0 控制面产品化”能力：建议在 iMessage I/O 主链路稳定后接入。
