# 任务单：Runtime skill 仓库源与安装目录单一真相源

## 回链

- Issue: [0014](/Users/admin/GitProjects/msgcode/issues/tk0014.dne.runtime.runtime-skill-source-sync.md)
- Plan: docs/plan/pl0014.dne.runtime.runtime-skill-source-sync.md

## 目标

1. 将 runtime skill 真相源收口到仓库内 `src/skills/runtime/`
2. 让 `msgcode init` 与 `msgcode start` 幂等同步托管 runtime skills
3. 保留用户自定义 skill 与 `index.json`

## 范围

1. `src/skills/runtime/`
2. `src/skills/runtime-sync.ts`
3. `src/cli.ts`
4. `src/commands.ts`
5. `src/skills/README.md`
6. 相关回归测试

## 非范围

1. 不重做整个历史 skill 系统
2. 不新增 skill 控制层
3. 不改变 tool loop 读取 `~/.config/msgcode/skills/index.json` 的主口径

## 验收

1. `msgcode init` 可同步托管 runtime skills
2. `msgcode start` 可 best-effort 补齐托管 runtime skills
3. 用户自定义 skill 不会被覆盖丢失
4. 回归测试通过
