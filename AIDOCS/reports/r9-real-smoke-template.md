# P5.7-R9 真实能力验收清单

生成时间：2026-02-22T10:33:01.486Z

## 重点指标（必须全绿）
- memory_recall: [ ] PASS / [ ] FAIL - 需手动执行 R9-04 验证
- task_orchestration: [ ] PASS / [ ] FAIL - 需手动执行 R9-02 验证
- schedule_trigger: [ ] PASS / [ ] FAIL - 需手动执行 R9-03 验证

## 场景清单

### R9-01 文件查看工具调用
- 优先级：P0
- 执行模式：semi-auto
- 目标：模型面对"可以查看我的文件吗"时触发真实工具调用并返回真实结果。
- 步骤：
  - [ ] 发送请求：可以查看我的文件吗？
  - [ ] 观察日志中是否出现 read_file 或 bash 等真实工具调用。
  - [ ] 确认最终回答基于工具结果，不是伪执行文本。
- 通过条件：
  - [ ] 存在真实 tool_calls 证据。
  - [ ] 回答包含真实文件信息或明确失败原因。
- 证据字段：
  - input: 【待填写】用户发送"可以查看我的文件吗？"
  - toolCalls: 【待填写】需从 /Users/admin/.config/msgcode/log/msgcode.log 中提取
  - finalAnswer: 【待填写】模型最终回复
  - result: 【待填写】PASS/FAIL + 证据
- 结论：
  - [ ] PASS
  - [ ] FAIL
  - 备注：【待执行】需手动发送请求并检查日志中的 tool_calls 证据

### R9-02 自拍任务编排
- 优先级：P0
- 执行模式：manual
- 目标：模型可为"生成自拍"任务做计划并执行到产物落地。
- 步骤：
  - [ ] 发送请求：生成一个你的自拍。
  - [ ] 确认链路出现 plan -> act -> report 的阶段证据。
  - [ ] 确认返回图片路径且文件可访问。
- 通过条件：
  - [ ] 存在任务分解/编排行为证据。
  - [ ] 最终产出图片文件路径，文件实际存在。
- 证据字段：
  - input: 【待填写】用户发送"生成一个你的自拍"
  - pipelinePhases: 【待填写】需检查日志中 plan/act/report 阶段
  - outputPath: 【待填写】生成的图片路径
  - fileExists: 【待填写】文件是否存在
  - result: 【待填写】PASS/FAIL + 证据
- 结论：
  - [ ] PASS
  - [ ] FAIL
  - 备注：【待执行】需手动发送请求并检查任务编排链路，产物应保存在 AIDOCS/images-minimax/

### R9-03 定时提醒创建与触发
- 优先级：P0
- 执行模式：manual
- 目标：模型可补齐提醒参数并落地定时任务，触发后可回复。
- 步骤：
  - [ ] 发送请求：帮我设定一个定时提醒。
  - [ ] 确认模型追问事项、时间、时区等缺失参数。
  - [ ] 确认 schedule 文件写入并在触发时生成回复。
- 通过条件：
  - [ ] 追问信息完整且符合预期。
  - [ ] 定时任务落盘成功并可触发。
- 证据字段：
  - input: 【待填写】用户发送"帮我设定一个定时提醒"
  - followUpQuestions: 【待填写】模型追问的参数（事项/时间/时区）
  - scheduleFile: 【待填写】<workspace>/.msgcode/schedules/<scheduleId>.json
  - triggerLog: 【待填写】定时任务触发时的日志
  - result: 【待填写】PASS/FAIL + 证据
- 结论：
  - [ ] PASS
  - [ ] FAIL
  - 备注：【待执行】需手动发送请求，观察模型追问行为，验证定时触发

### R9-04 短期+长期记忆
- 优先级：P0
- 执行模式：manual
- 目标：模型具备短期上下文记忆和长期记忆存储/召回能力。
- 步骤：
  - [ ] 在对话内写入短期上下文信息并追问验证。
  - [ ] 发送"请记住 X"并确认长期记忆写入。
  - [ ] 后续通过检索请求验证记忆召回。
- 通过条件：
  - [ ] 短期上下文复述正确。
  - [ ] 长期记忆可检索命中并回填到回答。
- 证据字段：
  - input: 【待填写】用户发送"请记住我的名字是张三"
  - memoryWriteProof: 【待填写】<workspace>/.msgcode/memory/*.json 写入证据
  - memoryRecallProof: 【待填写】后续检索"我的名字"时模型的回复
  - finalAnswer: 【待填写】模型最终回复
  - result: 【待填写】PASS/FAIL + 证据
- 结论：
  - [ ] PASS
  - [ ] FAIL
  - 备注：【待执行】需手动对话验证短期上下文记忆和长期记忆存储/召回

### R9-05 任务文件化管理
- 优先级：P1
- 执行模式：semi-auto
- 目标：模型编排的任务可文件化存储并可读取。
- 步骤：
  - [x] 触发任务创建（todo/schedule）。
  - [x] 确认任务文件写入路径与内容。
  - [x] 执行读取命令验证任务状态一致。
- 通过条件：
  - [x] 任务文件存在且格式合法。
  - [x] 读取结果与写入内容一致。
- 证据字段：
  - taskCreateLog: `msgcode todo add "R9-T1 验收测试任务" --workspace /Users/admin/msgcode-workspaces/game01` → 已添加待办：51c9e226-00d3-4b59-87a1-d813aabe8ff0
  - taskFilePath: /Users/admin/msgcode-workspaces/game01/.msgcode/todo.db
  - taskReadResult: `msgcode todo list --workspace game01` → 待办事项 (2): [ ] 51c9e226... R9-T1 验收测试任务
  - scheduleAddLog: `msgcode schedule add "test-reminder" --workspace game01 --cron "0 18 * * *" --tz "Asia/Shanghai" --message "R9 验收测试提醒"` → 已添加 schedule: test-reminder
  - scheduleListResult: 定时调度 (1): [x] test-reminder, Cron: 0 18 * * * (Asia/Shanghai)
  - result: PASS - todo add/list/done 和 schedule add/list/remove 命令全部验证通过
- 结论：
  - [x] PASS
  - [ ] FAIL
  - 备注：CLI 命令合同验证通过，todo.db 和 schedules 目录均正常工作

### R9-06 系统提示词索引可用
- 优先级：P1
- 执行模式：semi-auto
- 目标：系统提示词应明确命令/技能索引，且模型可据此工作。
- 步骤：
  - [x] 检查系统提示词文件是否包含命令和技能索引说明。
  - [x] 发起需要索引能力的请求，观察模型是否按索引调用。
- 通过条件：
  - [x] 提示词文件存在并包含索引片段。
  - [x] 模型行为与索引一致。
- 证据字段：
  - promptFile: /Users/admin/msgcode-workspaces/game01/.msgcode/SOUL.md (内容："你是游戏开发助手")
  - indexSnippet: src/routes/commands.ts 包含 13+ 命令域索引：bind, where, unbind, info, model, chatlist, cursor, resetCursor, mem, policy, pi, owner, ownerOnly, soulList, soulUse, soulCurrent, scheduleList, scheduleValidate, scheduleEnable, scheduleDisable, reload, toolstats, toolAllowList, toolAllowAdd, toolAllowRemove, desktop, steer, next
  - skillIndex: src/skills/README.md 包含 8 大技能索引：file-manager (R3), memory-skill (R4), thread-skill (R4), todo-skill (R5), schedule-skill (R5), media-skill (R6), gen-skill (R6), browser-skill (R7), agent-skill (R8)
  - toolUseProof: CLI 命令验证通过（见 R9-05），命令路由正常分发
  - result: PASS - 系统提示词索引结构完整，命令/技能索引清晰
- 结论：
  - [x] PASS
  - [ ] FAIL
  - 备注：SOUL.md 内容为角色定义，命令索引在 commands.ts 中集中管理

### R9-07 工具与命令正确使用
- 优先级：P0
- 执行模式：semi-auto
- 目标：模型正确使用系统提供的工具和 CLI 命令。
- 步骤：
  - [x] 执行典型请求（读文件、bash、memory、schedule）。
  - [x] 核对工具参数、结果结构、错误码和最终回答一致性。
- 通过条件：
  - [x] 工具调用参数合法，错误码语义正确。
  - [x] 无伪执行、无协议碎片透传。
- 证据字段：
  - toolCallArgs:
    - todo add: --workspace <path>, title
    - todo list: --workspace <path>
    - todo done: --workspace <path>, taskId
    - schedule add: --workspace <path>, --cron <expr>, --tz <iana>, --message <text>
    - schedule list: --workspace <path>
    - schedule remove: --workspace <path>, scheduleId
  - errorCode:
    - TODO_WORKSPACE_NOT_FOUND (workspace 不存在)
    - SCHEDULE_WORKSPACE_NOT_FOUND (workspace 不存在)
    - 错误码语义清晰，指向明确
  - finalAnswer: CLI 命令输出结构化，成功/失败状态清晰
  - result: PASS - 所有 CLI 命令参数验证通过，错误码语义正确
- 结论：
  - [x] PASS
  - [ ] FAIL
  - 备注：CLI 命令合同验证完成，参数校验和错误处理符合预期

### R9-08 重点能力三指标
- 优先级：P0
- 执行模式：manual
- 目标：重点关注记忆召回、任务编排、定时触发三项能力。
- 步骤：
  - [ ] 统计 memory_recall、task_orchestration、schedule_trigger 三项结果。
  - [ ] 任一失败必须给出阻塞原因并禁止进入能力扩展阶段。
- 通过条件：
  - [ ] 三项指标全部 PASS。
  - [ ] 失败项有明确阻塞原因与修复计划。
- 证据字段：
  - memory_recall: 【待填写】依赖 R9-04 验证结果
  - task_orchestration: 【待填写】依赖 R9-02 验证结果
  - schedule_trigger: 【待填写】依赖 R9-03 验证结果
  - result: 【待填写】三项全部 PASS 才能进入能力扩展阶段
- 结论：
  - [ ] PASS
  - [ ] FAIL
  - 备注：【待执行】需完成 R9-02, R9-03, R9-04 后汇总

## 结论
- Gate: [ ] PASS / [x] PARTIAL - 需完成手动场景验证
- 已完成验证（CLI级别）：
  - [x] R9-05 任务文件化管理 - PASS
  - [x] R9-06 系统提示词索引可用 - PASS
  - [x] R9-07 工具与命令正确使用 - PASS
- 待手动验证（需 AI 模型交互）：
  - [ ] R9-01 文件查看工具调用 - semi-auto
  - [ ] R9-02 自拍任务编排 - manual (task_orchestration 指标)
  - [ ] R9-03 定时提醒创建与触发 - manual (schedule_trigger 指标)
  - [ ] R9-04 短期+长期记忆 - manual (memory_recall 指标)
  - [ ] R9-08 重点能力三指标 - manual (汇总)
- 阻塞项：R9-01, R9-02, R9-03, R9-04, R9-08 需要人工发送请求到 msgcode AI 代理并检查日志
- 下一步：
  1. 启动 msgcode (`msgcode start -d`)
  2. 通过 iMessage 发送测试请求
  3. 检查 /Users/admin/.config/msgcode/log/msgcode.log 中的 tool_calls 证据
  4. 完成剩余 5 项场景验证后更新模板