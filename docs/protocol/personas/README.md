# Persona Protocol

## 位置

- 正式路径：`docs/protocol/personas/<persona-id>.md`

## 目的

- `skill` 说明“会什么”
- `persona` 说明“怎么做”
- `client` 说明“谁来执行”

不要把 persona 做成新的控制层。
它只是子代理启动时注入的一份工作说明书。

## 最小字段

每份 persona 文档至少包含：

- front matter
  - `id`
  - `title`
  - `why`
  - `scope`
  - `accept`
- 正文
  - `Role`
  - `When To Use`
  - `Default Workflow`
  - `Quality Bar`
  - `Forbidden Moves`
  - `Handoff Format`

## 当前正式 persona

- `frontend-builder`
- `code-reviewer`
- `api-builder`

## 硬规则

- persona 不表达安装逻辑
- persona 不表达第二套状态
- persona id 必须和文件名一一对应
- runtime 只认这条路径，不猜别名，不扫别处
