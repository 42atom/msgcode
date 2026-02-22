# P5.7-R9 真实能力验收清单

生成时间：2026-02-22T10:33:01.486Z

## 重点指标（必须全绿）
- memory_recall: [ ] PASS / [ ] FAIL
- task_orchestration: [ ] PASS / [ ] FAIL
- schedule_trigger: [ ] PASS / [ ] FAIL

## 场景清单

### R9-01 文件查看工具调用
- 优先级：P0
- 执行模式：semi-auto
- 目标：模型面对“可以查看我的文件吗”时触发真实工具调用并返回真实结果。
- 步骤：
  - [ ] 发送请求：可以查看我的文件吗？
  - [ ] 观察日志中是否出现 read_file 或 bash 等真实工具调用。
  - [ ] 确认最终回答基于工具结果，不是伪执行文本。
- 通过条件：
  - [ ] 存在真实 tool_calls 证据。
  - [ ] 回答包含真实文件信息或明确失败原因。
- 证据字段：
  - input: 
  - toolCalls: 
  - finalAnswer: 
  - result: 
- 结论：
  - [ ] PASS
  - [ ] FAIL
  - 备注：

### R9-02 自拍任务编排
- 优先级：P0
- 执行模式：manual
- 目标：模型可为“生成自拍”任务做计划并执行到产物落地。
- 步骤：
  - [ ] 发送请求：生成一个你的自拍。
  - [ ] 确认链路出现 plan -> act -> report 的阶段证据。
  - [ ] 确认返回图片路径且文件可访问。
- 通过条件：
  - [ ] 存在任务分解/编排行为证据。
  - [ ] 最终产出图片文件路径，文件实际存在。
- 证据字段：
  - input: 
  - pipelinePhases: 
  - outputPath: 
  - fileExists: 
  - result: 
- 结论：
  - [ ] PASS
  - [ ] FAIL
  - 备注：

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
  - input: 
  - followUpQuestions: 
  - scheduleFile: 
  - triggerLog: 
  - result: 
- 结论：
  - [ ] PASS
  - [ ] FAIL
  - 备注：

### R9-04 短期+长期记忆
- 优先级：P0
- 执行模式：manual
- 目标：模型具备短期上下文记忆和长期记忆存储/召回能力。
- 步骤：
  - [ ] 在对话内写入短期上下文信息并追问验证。
  - [ ] 发送“请记住 X”并确认长期记忆写入。
  - [ ] 后续通过检索请求验证记忆召回。
- 通过条件：
  - [ ] 短期上下文复述正确。
  - [ ] 长期记忆可检索命中并回填到回答。
- 证据字段：
  - input: 
  - memoryWriteProof: 
  - memoryRecallProof: 
  - finalAnswer: 
  - result: 
- 结论：
  - [ ] PASS
  - [ ] FAIL
  - 备注：

### R9-05 任务文件化管理
- 优先级：P1
- 执行模式：semi-auto
- 目标：模型编排的任务可文件化存储并可读取。
- 步骤：
  - [ ] 触发任务创建（todo/schedule）。
  - [ ] 确认任务文件写入路径与内容。
  - [ ] 执行读取命令验证任务状态一致。
- 通过条件：
  - [ ] 任务文件存在且格式合法。
  - [ ] 读取结果与写入内容一致。
- 证据字段：
  - taskCreateLog: 
  - taskFilePath: 
  - taskReadResult: 
  - result: 
- 结论：
  - [ ] PASS
  - [ ] FAIL
  - 备注：

### R9-06 系统提示词索引可用
- 优先级：P1
- 执行模式：semi-auto
- 目标：系统提示词应明确命令/技能索引，且模型可据此工作。
- 步骤：
  - [ ] 检查系统提示词文件是否包含命令和技能索引说明。
  - [ ] 发起需要索引能力的请求，观察模型是否按索引调用。
- 通过条件：
  - [ ] 提示词文件存在并包含索引片段。
  - [ ] 模型行为与索引一致。
- 证据字段：
  - promptFile: 
  - indexSnippet: 
  - toolUseProof: 
  - result: 
- 结论：
  - [ ] PASS
  - [ ] FAIL
  - 备注：

### R9-07 工具与命令正确使用
- 优先级：P0
- 执行模式：semi-auto
- 目标：模型正确使用系统提供的工具和 CLI 命令。
- 步骤：
  - [ ] 执行典型请求（读文件、bash、memory、schedule）。
  - [ ] 核对工具参数、结果结构、错误码和最终回答一致性。
- 通过条件：
  - [ ] 工具调用参数合法，错误码语义正确。
  - [ ] 无伪执行、无协议碎片透传。
- 证据字段：
  - toolCallArgs: 
  - errorCode: 
  - finalAnswer: 
  - result: 
- 结论：
  - [ ] PASS
  - [ ] FAIL
  - 备注：

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
  - memory_recall: 
  - task_orchestration: 
  - schedule_trigger: 
  - result: 
- 结论：
  - [ ] PASS
  - [ ] FAIL
  - 备注：

## 结论
- Gate: [ ] PASS / [ ] FAIL
- 阻塞项：
- 下一步：